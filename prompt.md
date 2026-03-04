# Summary

We need to refactor the copilot plugin plugins/rigorous-dev. Currently, it has a set of skills, commands
and mcp servers whose purpose is to rigourously define a set of requirements for building high quality software
and then buidling that software based off those requirements.

However, the implementation is based on yaml documents and schemas. This is extremely expensive in terms
of token consumption and context window, especially when it comes to doing significant updates or reading the entire 
set of documents.

We need to move to a much more efficient data access layer. This access layer should be sqlitte.

One of the most important goals to this change is to radically improve traceabilty. We should be able to easily and 
quickly identify why any change in our system happened and to do so in a way that is most efficient for an LLM AND easy 
for a human to understand and query as well.

For example, why are we using rust or go, the skill should be able to query database and then report
back which ADRs and requirements are responsible.

## Changelog
the database is a record of decisions made to arrive at a set of deliverable assets.

each record should be tied to an iteration because we want the critic to only look at things for htat iteration. It should only validate
what occurs in an iteration. It should significantly reduce token utilization.

assets are probably what we version in VCS.

What belongs in the changelog:
- requirements
- architectural decision records
- personas: should be tightly coupled to one or more requirements. typically introduced in an iteration

### Workflow

The way these skills and agents work together is based on producer-critic loop. First, an agent produces
output. Then, a critic agent evaluates that output and frequently will require changes. This starts an iterative
process between producer and critic until the output is of acceptable quality to the critic.

Then, and only then, can the workflow proceed to the next phase. 

It is critical that this producer-critic dynamic is encoded in the SQL data model.

The changelog must track the number of loops that occur between a producer and its critic. entries
are append all. For a given ADR, there might be 5 or 6 versions of it before a critic is satisfied and
eacn of those versions should be a new entry in the changelog.

NOTE VERY IMPORTANT THE LOOPS BETWEEN A PRODUCER AND CRITIC IS NOT AN ITERATION THEY OCCUR WITHIN AN
ITERATION.

### Iteration

An iteration is any request to change the system. It produces:
- decisions made as part of that request
- the assets necessary to satisfy the goal of that iteration

The changelog should  track the assets produced by the iteration by linking what was produced in
the vcs to a record in the database.

### Intermediate Assets

We have a producer-critic loop where the producer needs to share outputs or decisions with the critic.
This should be recorded in the changelog. Some examples:
- work items
- plans
- commits that were done as part of a change so a critic can know what commits to view in the VCS.
  This is critical for identifying files modified or produced.

## Asset Deliverables
These get commited and versioned in VCS. The changelog is the set of decisions that guides
production of these assets.
- architectural diagram (e.g c4 component diagram)
- data model (e.g SQL DDL, REST API): these are entites NOT interactions. This handles state. Interactions are handled with interfaces.
- interfaces: this describes behavior NOT state
- UX design system (e.g html document for how to design frontend)
- actual source code (e.g C#, golang, html)
- toolchain to build software
- tests

## Implementation

- We should provide skills to a user so they can ask questions of the changelog.
- When designing the SQL ddl based off the yaml schemas, you must be very careful to fully normalize the data model.
  For example, if you see an array that should be normalized into a table. You should NEVER have a json blob that is san example of BAD denormalization.

## Glossary
- producer: an agent that generates a decision (e.g ADR) or deliverables (e.g software); sometimes via an interview with the user
- critic: evaluates the output of a producer and determines whether the output is of acceptable quality; may reject producer output which forces producer to try again
- producer-critic loop: one exchange between a producer and a critic feedback
- phase: a collection of producer-critic loops; you exit the phase when when the critic is satisfied.
- iteration: a set of phases that together record decisions and produce associated deliverables
- persona: the user of the system and what their goal is. The are very closely related to requirements.
- architectural decision records (ADRS)
- Analyze is examine the requirements for gaps.
- Design is propose solutions to things.
- Review is looking for bugs in code or divergences from the plan or requirements. And essentially the same for documentation as well.

