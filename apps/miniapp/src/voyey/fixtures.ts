import type { CatalogProduct, CatalogCategory } from "../lib/catalog";
import type { CatalogAttributeValues, SaleMode } from "@stenzo/shared";

export type DemoVariant = CatalogProduct["variants"][number] & {
  preorderEnabled: boolean;
  attributes: CatalogAttributeValues;
  colorHex?: string;
  nameRu: string;
  nameUz: string;
};
export type DemoCategory = CatalogCategory & {
  image: ImageKey;
  requiresBuyerMeasurements: boolean;
};
export type ImageKey = "notebook" | "markers" | "hoodie" | "care" | "pouch";
export type DemoProduct = Omit<CatalogProduct, "category" | "variants"> & {
  category: DemoCategory;
  variants: DemoVariant[];
  image: ImageKey;
  descriptionRu: string;
  descriptionUz: string;
  attributes: CatalogAttributeValues;
  attributeLabels: Record<string, { ru: string; uz: string }>;
  newRank: number;
  popularity: number;
};
export const categories: DemoCategory[] = [
  {
    id: "stationery",
    slug: "stationery",
    nameRu: "Канцтовары",
    nameUz: "Kanselyariya",
    sortOrder: 0,
    image: "notebook",
    requiresBuyerMeasurements: false,
  },
  {
    id: "clothing",
    slug: "clothing",
    nameRu: "Одежда",
    nameUz: "Kiyim",
    sortOrder: 1,
    image: "hoodie",
    requiresBuyerMeasurements: true,
  },
  {
    id: "hygiene",
    slug: "hygiene",
    nameRu: "Гигиена",
    nameUz: "Gigiyena",
    sortOrder: 2,
    image: "care",
    requiresBuyerMeasurements: false,
  },
  {
    id: "home",
    slug: "home",
    nameRu: "Для дома",
    nameUz: "Uy uchun",
    sortOrder: 3,
    image: "pouch",
    requiresBuyerMeasurements: false,
  },
  {
    id: "gifts",
    slug: "gifts",
    nameRu: "Подарки",
    nameUz: "Sovg‘alar",
    sortOrder: 4,
    image: "notebook",
    requiresBuyerMeasurements: false,
  },
];
const variant = (
  id: string,
  stock: number | null,
  preorderEnabled: boolean,
  ru: string,
  uz: string,
  color: string | null = null,
  colorHex?: string,
  size = "",
): DemoVariant => ({
  id,
  sku: `DEMO-${id.toUpperCase()}`,
  size,
  color,
  stock,
  isAvailable: true,
  preorderEnabled,
  attributes: {},
  colorHex,
  nameRu: ru,
  nameUz: uz,
});
function product(
  id: string,
  cat: number,
  image: ImageKey,
  price: number,
  ru: string,
  uz: string,
  variants: DemoVariant[],
  attributes: CatalogAttributeValues,
  attributeLabels: DemoProduct["attributeLabels"],
  descriptionRu: string,
  descriptionUz: string,
  newRank: number,
): DemoProduct {
  return {
    id,
    slug: id,
    nameRu: ru,
    nameUz: uz,
    category: categories[cat]!,
    image,
    price,
    currency: "UZS",
    variants,
    attributes,
    attributeLabels,
    descriptionRu,
    descriptionUz,
    images: [],
    newRank,
    popularity:
      (
        {
          planner: 100,
          markers: 90,
          hoodie: 80,
          soap: 70,
          pouch: 60,
          gift: 50,
        } as Record<string, number>
      )[id] ?? 0,
  };
}
// Synthetic catalog only. Prices, stock and photos do not represent real inventory.
export const products: DemoProduct[] = [
  product(
    "planner",
    0,
    "notebook",
    89000,
    "Планер Premium A5",
    "Premium A5 rejalashtirgich",
    [
      variant("planner-pink", 8, true, "Розовый", "Pushti", "pink", "#edc4b8"),
      variant(
        "planner-sage",
        4,
        true,
        "Шалфейный",
        "Mavrak",
        "sage",
        "#91a18f",
      ),
      variant(
        "planner-ivory",
        6,
        false,
        "Молочный",
        "Sutrang",
        "ivory",
        "#ece5da",
      ),
    ],
    { format: "A5", pages: 160, material: "Paper" },
    {
      format: { ru: "Формат", uz: "O‘lcham" },
      pages: { ru: "Страниц", uz: "Sahifalar" },
      material: { ru: "Материал", uz: "Material" },
    },
    "Место для больших идей и маленьких планов. Плотные страницы в точку, удобная пружина и приятная на ощупь обложка.",
    "Katta g‘oyalar va kundalik rejalar uchun. Nuqtali qalin varaqlar, qulay spiral va yoqimli muqova.",
    2,
  ),
  product(
    "markers",
    0,
    "markers",
    72000,
    "Набор пастельных маркеров",
    "Pastel markerlar to‘plami",
    [variant("markers-12", 0, true, "12 цветов", "12 rang")],
    { pack_quantity: 12 },
    { pack_quantity: { ru: "В упаковке", uz: "To‘plamda" } },
    "Двенадцать мягких оттенков для заметок, рисунков и творческих идей.",
    "Qaydlar, chizmalar va ijod uchun o‘n ikki mayin rang.",
    1,
  ),
  product(
    "hoodie",
    1,
    "hoodie",
    299000,
    "Худи из мягкого хлопка",
    "Yumshoq paxtali xudi",
    [
      variant(
        "hoodie-m",
        3,
        true,
        "Песочный · M",
        "Qumrang · M",
        "sand",
        "#d7b899",
        "M",
      ),
      variant(
        "hoodie-l",
        0,
        true,
        "Песочный · L",
        "Qumrang · L",
        "sand",
        "#d7b899",
        "L",
      ),
    ],
    { material: "Cotton" },
    { material: { ru: "Материал", uz: "Material" } },
    "Свободный силуэт и мягкий хлопок на каждый день. Для выбора посадки укажите рост и вес.",
    "Kundalik erkin bichim va yumshoq paxta. Mos o‘lcham uchun bo‘y va vazningizni kiriting.",
    3,
  ),
  product(
    "soap",
    2,
    "care",
    49000,
    "Жидкое мыло для рук",
    "Suyuq qo‘l sovuni",
    [variant("soap-300", 12, false, "300 мл", "300 ml")],
    { volume_ml: 300 },
    { volume_ml: { ru: "Объём, мл", uz: "Hajm, ml" } },
    "Простая забота о чистоте рук. Удобный дозатор для повседневного использования.",
    "Qo‘llar tozaligi uchun kundalik parvarish. Qulay dozatorli idish.",
    5,
  ),
  product(
    "pouch",
    3,
    "pouch",
    39000,
    "Текстильный органайзер",
    "Matoli organayzer",
    [
      variant(
        "pouch-rose",
        5,
        true,
        "Пудровый",
        "Pudrarang",
        "rose",
        "#d8a0a0",
      ),
    ],
    { material: "Fabric" },
    { material: { ru: "Материал", uz: "Material" } },
    "Для ручек, небольших вещей и порядка в сумке. Мягкая ткань и удобная молния.",
    "Ruchkalar, kichik buyumlar va sumkadagi tartib uchun. Yumshoq mato va qulay fermuar.",
    0,
  ),
  product(
    "gift",
    4,
    "notebook",
    99000,
    "Блокнот для добрых пожеланий",
    "Yaxshi tilaklar daftari",
    [variant("gift-a5", 4, false, "A5", "A5")],
    { format: "A5" },
    { format: { ru: "Формат", uz: "O‘lcham" } },
    "Небольшой подарок для человека с большими планами. Временное изображение демонстрационного каталога.",
    "Katta rejalari bor inson uchun kichik sovg‘a. Namoyish katalogining vaqtinchalik surati.",
    4,
  ),
];
export type DemoCartRow = {
  id: string;
  productId: string;
  variantId: string;
  saleMode: SaleMode;
  quantity: number;
  heightCm: number | null;
  weightKg: number | null;
};
export const initialCart: DemoCartRow[] = [
  {
    id: "planner-pink:IN_STOCK",
    productId: "planner",
    variantId: "planner-pink",
    saleMode: "IN_STOCK",
    quantity: 1,
    heightCm: null,
    weightKg: null,
  },
  {
    id: "soap-300:IN_STOCK",
    productId: "soap",
    variantId: "soap-300",
    saleMode: "IN_STOCK",
    quantity: 1,
    heightCm: null,
    weightKg: null,
  },
  {
    id: "markers-12:PREORDER",
    productId: "markers",
    variantId: "markers-12",
    saleMode: "PREORDER",
    quantity: 1,
    heightCm: null,
    weightKg: null,
  },
];
