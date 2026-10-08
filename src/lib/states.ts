export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "PR", name: "Puerto Rico" },
];

const BY_CODE = new Map(US_STATES.map((s) => [s.code, s.name]));
const BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s.code]));

export const ALL_STATES = "ALL";

export function stateName(code: string): string {
  if (code === ALL_STATES) return "All states";
  return BY_CODE.get(code) ?? code;
}

/**
 * Normalize whatever a customer typed into an address "state" field to a
 * two-letter code: "OK", "ok", "Okla", "Oklahoma ", "Oklahoma." all become "OK".
 * Returns null if it cannot be recognized.
 */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\./g, "").replace(/\s+/g, " ");
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  const byName = BY_NAME.get(cleaned.toLowerCase());
  if (byName) return byName;
  const abbrev = ABBREVIATIONS[cleaned.toLowerCase()];
  if (abbrev) return abbrev;
  return null;
}

// Common non-postal abbreviations people type.
const ABBREVIATIONS: Record<string, string> = {
  ala: "AL", ariz: "AZ", ark: "AR", calif: "CA", cal: "CA", colo: "CO", conn: "CT",
  del: "DE", fla: "FL", "washington dc": "DC", "d c": "DC", ill: "IL", ind: "IN",
  kans: "KS", kan: "KS", mass: "MA", mich: "MI", minn: "MN", miss: "MS", mont: "MT",
  nebr: "NE", neb: "NE", nev: "NV", okla: "OK", ore: "OR", oreg: "OR", penn: "PA",
  penna: "PA", tenn: "TN", tex: "TX", wash: "WA", wis: "WI", wisc: "WI", wyo: "WY",
  "n carolina": "NC", "s carolina": "SC", "n dakota": "ND", "s dakota": "SD",
  "w virginia": "WV",
};
