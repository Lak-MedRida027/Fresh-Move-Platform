export interface ImportMember {
  full_name: string;
  phone: string;
  wilaya_code: string;
  age: number;
  consent_at: string;
  created_at: string;
  source: 'import';
}
export function parseCsv(text: string): string[][];
export function normalizePhone(raw: string): string | null;
export function algiersTimestamp(raw: string): string | null;
export function mapMembers(rows: string[][]): {
  members: ImportMember[];
  skipped: Record<'phone' | 'name' | 'wilaya' | 'age' | 'consent' | 'date' | 'duplicate', number>;
  rows: number;
};
