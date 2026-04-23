// Non-component exports kept out of editorial/atoms.jsx so React Fast Refresh
// stays happy (the rule requires JSX files to only export components).

export const cx = (...p) => p.filter(Boolean).join(' ');

export const ACCENTS = {
  gold:    '#C9A84C',
  emerald: '#10B981',
  cyan:    '#4CC9F0',
  amber:   '#F59E0B',
  rose:    '#E11D48',
  steel:   '#64748B',
};
