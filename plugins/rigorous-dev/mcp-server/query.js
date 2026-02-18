import { readFileSync } from "node:fs";
import yaml from "js-yaml";

/**
 * @typedef {Object} IdEntry
 * @property {string} id
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [category]
 * @property {string} [priority]
 * @property {string} [type]
 * @property {string} [goal]
 * @property {string} [purpose]
 * @property {number} [phase_number]
 */

/**
 * @typedef {Object} ListIdsResult
 * @property {string} artifact_type
 * @property {IdEntry[]} items
 * @property {string[]} sections - other top-level keys available for section queries
 */

/**
 * @typedef {Object} QueryOpts
 * @property {string[]} [ids] - return entries matching these IDs
 * @property {string} [field] - filter field name
 * @property {string} [value] - filter field value
 * @property {string} [section] - return an entire top-level section
 */

/** @type {Record<string, (item: any) => IdEntry>} */
const EXTRACTORS = {
  requirements: (r) => ({
    id: r.id,
    description: truncate(r.description, 80),
    category: r.category,
    priority: r.priority,
  }),
  personas: (p) => ({
    id: p.id,
    name: p.name,
    description: truncate(p.description, 80),
  }),
  components: (c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    purpose: truncate(c.purpose, 80),
  }),
  user_flows: (f) => ({
    id: f.id,
    name: f.name,
    goal: truncate(f.goal, 80),
  }),
  screens: (s) => ({
    id: s.id,
    name: s.name,
    purpose: truncate(s.purpose, 80),
  }),
  phases: (p) => ({
    id: `phase-${p.phase_number}`,
    phase_number: p.phase_number,
    name: p.name,
    type: p.type,
    goal: truncate(p.goal, 80),
  }),
};

/** @type {string[]} */
const ITEM_ARRAYS = Object.keys(EXTRACTORS);

/**
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function truncate(s, max) {
  if (!s || s.length <= max) return s || "";
  return s.slice(0, max) + "...";
}

/**
 * Load and parse a YAML file.
 * @param {string} artifactPath
 * @returns {Record<string, any>}
 */
function loadYaml(artifactPath) {
  const raw = readFileSync(artifactPath, "utf8");
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== "object") {
    throw new Error(`Expected YAML object, got ${typeof doc}`);
  }
  return /** @type {Record<string, any>} */ (doc);
}

/**
 * Detect which item arrays exist in a document and return their keys.
 * @param {Record<string, any>} doc
 * @returns {string[]}
 */
function detectItemArrays(doc) {
  return ITEM_ARRAYS.filter(
    (key) => Array.isArray(doc[key]) && doc[key].length > 0
  );
}

/**
 * Return a structural index of all identifiable items in an artifact.
 * @param {string} artifactPath
 * @returns {ListIdsResult}
 */
export function listIds(artifactPath) {
  const doc = loadYaml(artifactPath);
  const found = detectItemArrays(doc);

  /** @type {IdEntry[]} */
  const items = [];
  for (const key of found) {
    const extractor = EXTRACTORS[key];
    for (const entry of doc[key]) {
      items.push(extractor(entry));
    }
  }

  const sections = Object.keys(doc).filter((k) => !found.includes(k));

  // Determine artifact type from detected arrays
  let artifact_type = "unknown";
  if (found.includes("requirements")) artifact_type = "requirements";
  else if (found.includes("components")) artifact_type = "architecture_components";
  else if (found.includes("user_flows") || found.includes("screens"))
    artifact_type = "ux_specification";
  else if (found.includes("phases")) artifact_type = "implementation_plan";

  return { artifact_type, items, sections };
}

/**
 * Query an artifact for specific items by ID, field filter, or section.
 * @param {string} artifactPath
 * @param {QueryOpts} opts
 * @returns {{ results: any, match_count: number }}
 */
export function queryArtifact(artifactPath, opts) {
  const doc = loadYaml(artifactPath);

  // Section query — return an entire top-level key
  if (opts.section) {
    const section = doc[opts.section];
    if (section === undefined) {
      throw new Error(
        `Section "${opts.section}" not found. Available: ${Object.keys(doc).join(", ")}`
      );
    }
    const count = Array.isArray(section) ? section.length : 1;
    return { results: section, match_count: count };
  }

  // Collect all queryable items from all item arrays
  const found = detectItemArrays(doc);
  /** @type {any[]} */
  let allItems = [];
  for (const key of found) {
    for (const entry of doc[key]) {
      allItems.push(entry);
    }
  }

  // For implementation plan, also check requirements_mapping
  if (Array.isArray(doc.requirements_mapping)) {
    // Don't add to allItems — these are handled via field filter below
  }

  // ID query
  if (opts.ids && opts.ids.length > 0) {
    const idSet = new Set(opts.ids);
    // For phases, support both "phase-N" and plain number
    const phaseNumbers = new Set(
      opts.ids
        .filter((id) => id.startsWith("phase-"))
        .map((id) => parseInt(id.replace("phase-", ""), 10))
    );

    const matched = allItems.filter((item) => {
      if (item.id && idSet.has(item.id)) return true;
      if (item.phase_number && phaseNumbers.has(item.phase_number)) return true;
      return false;
    });
    return { results: matched, match_count: matched.length };
  }

  // Field filter query
  if (opts.field && opts.value !== undefined) {
    const matched = allItems.filter((item) => {
      const fieldVal = item[opts.field];
      if (fieldVal === undefined) return false;
      // Support array fields (e.g. requirements_addressed contains "REQ-003")
      if (Array.isArray(fieldVal)) return fieldVal.includes(opts.value);
      return String(fieldVal) === String(opts.value);
    });
    return { results: matched, match_count: matched.length };
  }

  throw new Error(
    "Must provide one of: ids, field+value, or section"
  );
}
