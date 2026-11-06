/**
 * Algerian wilayas (provinces), code + Arabic name + Latin (French) name.
 *
 * Verified November 2026: Algeria has 69 wilayas.
 * - 01–48: historic list.
 * - 49–58: created by law 19-12 (2019), operational 2021.
 * - 59–69: law 26-06 of 4 April 2026 (JO n° 25) and the numbering decree
 *   published in Journal officiel n° 40 (June 2026).
 * Sources checked: dzbuild.com "The 69 Wilayas of Algeria in 2026" and
 * Lexis Middle East news of 2026-06-06 (both agree on numbers 59–69).
 * TODO(owner): if the official names in the Journal officiel differ, fix them here.
 */
export interface Wilaya {
  code: string; // two digits, '01'..'69'
  ar: string;
  fr: string;
}

export const WILAYAS: readonly Wilaya[] = [
  { code: '01', ar: 'أدرار', fr: 'Adrar' },
  { code: '02', ar: 'الشلف', fr: 'Chlef' },
  { code: '03', ar: 'الأغواط', fr: 'Laghouat' },
  { code: '04', ar: 'أم البواقي', fr: 'Oum El Bouaghi' },
  { code: '05', ar: 'باتنة', fr: 'Batna' },
  { code: '06', ar: 'بجاية', fr: 'Béjaïa' },
  { code: '07', ar: 'بسكرة', fr: 'Biskra' },
  { code: '08', ar: 'بشار', fr: 'Béchar' },
  { code: '09', ar: 'البليدة', fr: 'Blida' },
  { code: '10', ar: 'البويرة', fr: 'Bouira' },
  { code: '11', ar: 'تمنراست', fr: 'Tamanrasset' },
  { code: '12', ar: 'تبسة', fr: 'Tébessa' },
  { code: '13', ar: 'تلمسان', fr: 'Tlemcen' },
  { code: '14', ar: 'تيارت', fr: 'Tiaret' },
  { code: '15', ar: 'تيزي وزو', fr: 'Tizi Ouzou' },
  { code: '16', ar: 'الجزائر', fr: 'Alger' },
  { code: '17', ar: 'الجلفة', fr: 'Djelfa' },
  { code: '18', ar: 'جيجل', fr: 'Jijel' },
  { code: '19', ar: 'سطيف', fr: 'Sétif' },
  { code: '20', ar: 'سعيدة', fr: 'Saïda' },
  { code: '21', ar: 'سكيكدة', fr: 'Skikda' },
  { code: '22', ar: 'سيدي بلعباس', fr: 'Sidi Bel Abbès' },
  { code: '23', ar: 'عنابة', fr: 'Annaba' },
  { code: '24', ar: 'قالمة', fr: 'Guelma' },
  { code: '25', ar: 'قسنطينة', fr: 'Constantine' },
  { code: '26', ar: 'المدية', fr: 'Médéa' },
  { code: '27', ar: 'مستغانم', fr: 'Mostaganem' },
  { code: '28', ar: 'المسيلة', fr: "M'Sila" },
  { code: '29', ar: 'معسكر', fr: 'Mascara' },
  { code: '30', ar: 'ورقلة', fr: 'Ouargla' },
  { code: '31', ar: 'وهران', fr: 'Oran' },
  { code: '32', ar: 'البيض', fr: 'El Bayadh' },
  { code: '33', ar: 'إليزي', fr: 'Illizi' },
  { code: '34', ar: 'برج بوعريريج', fr: 'Bordj Bou Arréridj' },
  { code: '35', ar: 'بومرداس', fr: 'Boumerdès' },
  { code: '36', ar: 'الطارف', fr: 'El Tarf' },
  { code: '37', ar: 'تندوف', fr: 'Tindouf' },
  { code: '38', ar: 'تيسمسيلت', fr: 'Tissemsilt' },
  { code: '39', ar: 'الوادي', fr: 'El Oued' },
  { code: '40', ar: 'خنشلة', fr: 'Khenchela' },
  { code: '41', ar: 'سوق أهراس', fr: 'Souk Ahras' },
  { code: '42', ar: 'تيبازة', fr: 'Tipaza' },
  { code: '43', ar: 'ميلة', fr: 'Mila' },
  { code: '44', ar: 'عين الدفلى', fr: 'Aïn Defla' },
  { code: '45', ar: 'النعامة', fr: 'Naâma' },
  { code: '46', ar: 'عين تموشنت', fr: 'Aïn Témouchent' },
  { code: '47', ar: 'غرداية', fr: 'Ghardaïa' },
  { code: '48', ar: 'غليزان', fr: 'Relizane' },
  { code: '49', ar: 'تيميمون', fr: 'Timimoun' },
  { code: '50', ar: 'برج باجي مختار', fr: 'Bordj Badji Mokhtar' },
  { code: '51', ar: 'أولاد جلال', fr: 'Ouled Djellal' },
  { code: '52', ar: 'بني عباس', fr: 'Béni Abbès' },
  { code: '53', ar: 'عين صالح', fr: 'In Salah' },
  { code: '54', ar: 'عين قزام', fr: 'In Guezzam' },
  { code: '55', ar: 'تقرت', fr: 'Touggourt' },
  { code: '56', ar: 'جانت', fr: 'Djanet' },
  { code: '57', ar: 'المغير', fr: "El M'Ghair" },
  { code: '58', ar: 'المنيعة', fr: 'El Meniaa' },
  { code: '59', ar: 'أفلو', fr: 'Aflou' },
  { code: '60', ar: 'بريكة', fr: 'Barika' },
  { code: '61', ar: 'القنطرة', fr: 'El Kantara' },
  { code: '62', ar: 'بئر العاتر', fr: 'Bir El Ater' },
  { code: '63', ar: 'العريشة', fr: 'El Aricha' },
  { code: '64', ar: 'قصر الشلالة', fr: 'Ksar Chellala' },
  { code: '65', ar: 'عين وسارة', fr: 'Aïn Oussera' },
  { code: '66', ar: 'مسعد', fr: 'Messaad' },
  { code: '67', ar: 'قصر البخاري', fr: 'Ksar El Boukhari' },
  { code: '68', ar: 'بوسعادة', fr: 'Bou Saâda' },
  { code: '69', ar: 'الأبيض سيدي الشيخ', fr: 'El Abiodh Sidi Cheikh' },
];

export const WILAYA_CODES = WILAYAS.map((w) => w.code);

export function getWilaya(code: string): Wilaya | undefined {
  return WILAYAS.find((w) => w.code === code);
}

/** Label shown in the dropdown, in the page language. */
export function wilayaLabel(w: Wilaya, locale: 'ar' | 'en'): string {
  return `${w.code} - ${locale === 'ar' ? w.ar : w.fr}`;
}
