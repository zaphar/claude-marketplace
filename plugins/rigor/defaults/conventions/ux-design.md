# UX Design Conventions

- Conduct work and mental model interviews before design direction — understand task stages, information needs, and decision points
- Generate at least 3 meaningfully distinct design variations for validation screens — not just color swaps
- Do not proceed to full screen set until user approves design direction
- 🔧 Support both light and dark themes unless the user explicitly declines
- Define a visual design system: color palette with accessibility ratios, typography scale, spacing system, and component library
- Every screen specification must have a corresponding HTML mockup
- Mockups must link to each other via relative hrefs for click-through browsing
- Design user flows that minimize friction and cognitive load
- Match the user's mental model for information architecture — not the specification's categories
- 🔧 WCAG accessibility compliance: color contrast ratios, keyboard navigation, screen reader support, logical focus order
- No reliance on color alone for conveying information
- Specify responsive behavior: breakpoints, layout adaptations, touch vs pointer interactions
- Define error states, loading states, and empty states for every screen
- Apply symmetry: create↔delete, start↔stop, forward↔back — document intentional omissions
- Map every user-facing requirement to UX elements
- Document explicit data requirements per screen for backend consumption
- Review peer-level screens as a set for structural consistency
- Stop and wait for user review after each mockup before proceeding
