import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { slug: "new-arrivals", nameRu: "Новинки", nameUz: "Yangi mahsulotlar" },
  { slug: "outerwear", nameRu: "Верхняя одежда", nameUz: "Ustki kiyim" },
  { slug: "hoodies", nameRu: "Худи", nameUz: "Hudi" },
  { slug: "t-shirts", nameRu: "Футболки", nameUz: "Futbolkalar" },
  { slug: "trousers", nameRu: "Брюки", nameUz: "Shimlar" },
  { slug: "jeans", nameRu: "Джинсы", nameUz: "Jinsi shimlar" },
  { slug: "shoes", nameRu: "Обувь", nameUz: "Oyoq kiyim" },
  { slug: "accessories", nameRu: "Аксессуары", nameUz: "Aksessuarlar" },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production");
  }

  for (const [sortOrder, category] of categories.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, sortOrder, isActive: true },
      update: {
        nameRu: category.nameRu,
        nameUz: category.nameUz,
        sortOrder,
      },
    });
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
