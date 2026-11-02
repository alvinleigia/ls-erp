export const INVENTORY_UNIT_OPTIONS = [
  "unit",
  "pcs",
  "ml",
  "l",
  "g",
  "kg",
  "pack",
  "box",
  "bottle",
  "tube",
  "jar",
] as const

export type InventoryUnit = (typeof INVENTORY_UNIT_OPTIONS)[number]

export const inventoryUnitLabels: Record<InventoryUnit, string> = {
  unit: "Unit", pcs: "Pieces (pcs)", ml: "Millilitres (ml)", l: "Litres (l)",
  g: "Grams (g)", kg: "Kilograms (kg)", pack: "Pack", box: "Box",
  bottle: "Bottle", tube: "Tube", jar: "Jar",
}
