// Find named empty nodes (e.g. flame_anchor) inside a model, in name order.
export function findNodes(root, prefix) {
  const out = [];
  root.traverse(o => { if (o.name && o.name.startsWith(prefix)) out.push(o); });
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
