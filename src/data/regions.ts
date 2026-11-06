/**
 * Regions and destinations, from docs/brand/Fresh_Move_Identity_File.md
 * ("Geographic Footprint"). Place names are content, so they live here with
 * both languages rather than in the UI string files.
 */
export const REGION_IDS = ['aures', 'kabylie-north-coast', 'northeast-coast', 'sahara', 'babors'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const TERRAINS = ['mountain', 'desert', 'coast', 'camping', 'heritage', 'diving'] as const;
export type Terrain = (typeof TERRAINS)[number];

/** Terrains offered in the trips filter (diving trips are also tagged coast). */
export const FILTER_TERRAINS = ['mountain', 'desert', 'coast', 'camping', 'heritage'] as const;

type Name = { ar: string; en: string };

export interface Region {
  id: RegionId;
  name: Name;
  /** Main terrain, used for the card accent color. */
  accent: Terrain;
  destinations: Name[];
}

export const REGIONS: Region[] = [
  {
    id: 'aures',
    name: { ar: 'الأوراس والشرق', en: 'Aurès & the East' },
    accent: 'mountain',
    destinations: [
      { ar: 'القنطرة', en: 'El Kantra' },
      { ar: 'بلزمة', en: 'Belezma' },
      { ar: 'شيليا', en: 'Chelia' },
      { ar: 'برج زمورة', en: 'Bordj Zemoura' },
      { ar: 'ثوقر', en: 'Thouqr' }, // TODO(owner): check the Arabic spelling of Thouqr
    ],
  },
  {
    id: 'kabylie-north-coast',
    name: { ar: 'القبائل والساحل الشمالي', en: 'Kabylie & North Coast' },
    accent: 'coast',
    destinations: [
      { ar: 'بجاية', en: 'Bejaia' },
      { ar: 'جيجل', en: 'Jijel' },
      { ar: 'مرسى الزيتون', en: 'Marsa Zitoune' },
    ],
  },
  {
    id: 'northeast-coast',
    name: { ar: 'الساحل الشرقي', en: 'Northeast Coast' },
    accent: 'coast',
    destinations: [
      { ar: 'القالة', en: 'El Kala' },
      { ar: 'واد تانجي', en: 'Oued Tangi' }, // TODO(owner): check the Arabic spelling of Oued Tangi
    ],
  },
  {
    id: 'sahara',
    name: { ar: 'الصحرا والجنوب الكبير', en: 'Sahara & Deep South' },
    accent: 'desert',
    destinations: [
      { ar: 'جانت', en: 'Djanet' },
      { ar: 'الطاسيلي', en: 'Tassili' },
    ],
  },
  {
    id: 'babors',
    name: { ar: 'جبال البابور', en: 'Babors Mountains' },
    accent: 'mountain',
    destinations: [
      { ar: 'سيدي جابر', en: 'Sidi Djaber' },
      { ar: 'تيزغبان', en: 'Tizeghben' },
    ],
  },
];

export function getRegion(id: RegionId): Region {
  const region = REGIONS.find((r) => r.id === id);
  if (!region) throw new Error(`Unknown region: ${id}`);
  return region;
}
