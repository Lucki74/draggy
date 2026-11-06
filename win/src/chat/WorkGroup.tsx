// Consecutive tool steps between two stretches of prose: one chain with a rule down its left side.
export function WorkGroup({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 ms-[7px] border-s border-rule pb-0.5 ps-4">{children}</div>;
}
export default WorkGroup;
