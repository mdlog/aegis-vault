// Source of truth for the dashboard TEE badge. Green "verified" ONLY when a
// real Intel-TDX quote was DCAP-verified this cycle (entry.teeVerified). A
// sealed-mode entry that was NOT hardware-verified shows a neutral "unattested"
// marker — never green. Pure + side-effect-free so it can be unit-tested
// without the React/jsdom toolchain.
export function teeBadgeState(entry) {
  if (entry?.teeVerified === true) return 'verified';
  if (entry?.sealedMode === true) return 'unattested';
  return 'none';
}
