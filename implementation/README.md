# Tracer-bullet implementation

- [PLAN.md](./PLAN.md) defines execution order and the common agent contract.
- [tasks/](./tasks/) contains one bounded packet per tracer-bullet step.
- [NTGRILL.md](./NTGRILL.md) bounds the separately authorized follow-on slice;
  it does not change the completed tracer plan or packets.
- [NTPLAN.md](./NTPLAN.md) bounds the separate planning slice; it does not
  rewrite the history of the completed tracer or ntgrill plans.
- [../PROJECT.md](../PROJECT.md) is the only current implementation status.

A fresh task session reads the plan, its packet, and only the runtime or phase
contracts relevant to that packet. It verifies dependencies, stays inside owned
files, runs the packet checks, reports evidence, and stops.
