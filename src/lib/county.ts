/** The county this deployment is built around. Everything else is generic. */
export const COUNTY = process.env.BELONG_COUNTY ?? "Montgomery";
export const COUNTY_LABEL = `${COUNTY} County, Maryland`;
/** Rough bounding box of Montgomery County, MD — used to sanity-check geocodes. */
export const COUNTY_BOX = { minLat: 38.93, maxLat: 39.36, minLng: -77.53, maxLng: -76.88 };
export function inCounty(lat: number, lng: number): boolean {
  return lat >= COUNTY_BOX.minLat && lat <= COUNTY_BOX.maxLat && lng >= COUNTY_BOX.minLng && lng <= COUNTY_BOX.maxLng;
}
