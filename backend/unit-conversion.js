const UNIT_DEFINITIONS = [
  { value: 'g', label: 'جرام', family: 'mass', factor: 1 },
  { value: 'kg', label: 'كجم', family: 'mass', factor: 1000 },
  { value: 'ml', label: 'مل', family: 'volume', factor: 1 },
  { value: 'l', label: 'لتر', family: 'volume', factor: 1000 },
  { value: 'piece', label: 'قطعة/وحدة', family: 'count', factor: 1 },
];
const ALIASES = { g:'g', gram:'g', grams:'g', جرام:'g', غرام:'g', جم:'g', kg:'kg', kilo:'kg', kilogram:'kg', كيلو:'kg', كجم:'kg', كغ:'kg', كيلوجرام:'kg', ml:'ml', milliliter:'ml', مليلتر:'ml', مل:'ml', l:'l', liter:'l', litre:'l', لتر:'l', piece:'piece', pieces:'piece', unit:'piece', وحدة:'piece', قطعة:'piece', حبة:'piece' };
function normalizeUnit(value){ const key=String(value||'').trim().toLowerCase(); return ALIASES[key]||key||'piece'; }
function getUnit(value){ return UNIT_DEFINITIONS.find(x=>x.value===normalizeUnit(value)); }
function unitError(code, fromUnit, toUnit){
  const error = new Error(`${code}:${fromUnit||''}:${toUnit||''}`);
  error.code = code;
  return error;
}
/**
 * Converts a quantity between units.
 *
 * Same family:  result = qty * from.factor / to.factor  (always in `to` units).
 *
 * Cross family (mass <-> volume): `context.inventoryWeight` is the CONVERSION
 * WEIGHT of the material in kilograms per ONE LITER (density), e.g. 1 liter of
 * oil = 0.92 kg. When omitted, water density (1 kg/l) is assumed for targets
 * that are liters. Results are always expressed in `to` units:
 *   mass   -> volume : liters(or ml) = grams / density, then scaled to `to`.
 *   volume -> mass   : grams = ml * density,          then scaled to `to`.
 * Count units are incompatible with mass/volume.
 */
function convertQuantity(quantity, fromUnit, toUnit, context={}){
  const from=getUnit(fromUnit), to=getUnit(toUnit), qty=Number(quantity);
  if(!from||!to||!Number.isFinite(qty)) {throw unitError('UNIT_INVALID', fromUnit, toUnit);}
  if(from.family===to.family) {return qty*from.factor/to.factor;}
  if((from.family==='mass'&&to.family==='volume')||(from.family==='volume'&&to.family==='mass')){
    // Default density 1 kg/l only applies when the target unit is liters.
    const inventoryWeight=Number(context.inventoryWeight||((to.family==='volume'&&to.value==='l')?1:0));
    if(!(inventoryWeight>0)) {throw unitError('UNIT_DENSITY_REQUIRED', fromUnit, toUnit);}
    const densityGramsPerMl = inventoryWeight; // kg per liter == grams per milliliter
    if(from.family==='mass'){
      const milliliters=(qty*from.factor)/densityGramsPerMl; // total ml
      return milliliters/to.factor; // scale ml -> target volume units
    }
    const grams=(qty*from.factor)*densityGramsPerMl; // total grams
    return grams/to.factor; // scale grams -> target mass units
  }
  throw unitError('UNIT_INCOMPATIBLE', fromUnit, toUnit);
}
function formatUnit(value){ return getUnit(value)?.label||String(value||'وحدة'); }
module.exports={UNIT_DEFINITIONS,normalizeUnit,getUnit,convertQuantity,formatUnit};
