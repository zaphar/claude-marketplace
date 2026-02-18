import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON pointer to the failing field
 * @property {string} message - Human-readable error description
 * @property {string} keyword - Ajv validation keyword that failed
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationError[]|null} errors
 */

/**
 * Validate a YAML artifact against a JSON Schema (also in YAML).
 * @param {string} artifactPath - Absolute path to the YAML artifact file
 * @param {string} schemaPath - Absolute path to the YAML schema file
 * @returns {Promise<ValidationResult>}
 */
export async function validateArtifact(artifactPath, schemaPath) {
  const artifactYaml = readFileSync(artifactPath, "utf8");
  const artifact = yaml.load(artifactYaml);

  const schemaYaml = readFileSync(schemaPath, "utf8");
  const schema = yaml.load(schemaYaml);

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(artifact);

  if (valid) {
    return { valid: true, errors: null };
  }

  const errors = (validate.errors || []).map((err) => ({
    path: err.instancePath || "/",
    message: err.message || "unknown error",
    keyword: err.keyword,
  }));

  return { valid: false, errors };
}
