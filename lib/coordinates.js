/**
 * Coordinate normalization utilities
 *
 * The Gemini Computer Use model returns coordinates in a normalized 0-999 range.
 * These utilities convert between normalized and actual pixel coordinates.
 */

const NORMALIZED_MAX = 1000;

/**
 * Convert normalized X coordinate (0-999) to actual pixels
 * @param {number} normalizedX - X coordinate in 0-999 range
 * @param {number} viewportWidth - Current viewport width in pixels
 * @returns {number} Actual pixel X coordinate
 */
export function denormalizeX(normalizedX, viewportWidth) {
  return Math.round((normalizedX / NORMALIZED_MAX) * viewportWidth);
}

/**
 * Convert normalized Y coordinate (0-999) to actual pixels
 * @param {number} normalizedY - Y coordinate in 0-999 range
 * @param {number} viewportHeight - Current viewport height in pixels
 * @returns {number} Actual pixel Y coordinate
 */
export function denormalizeY(normalizedY, viewportHeight) {
  return Math.round((normalizedY / NORMALIZED_MAX) * viewportHeight);
}

/**
 * Convert normalized coordinates to actual pixels
 * @param {number} normalizedX - X coordinate in 0-999 range
 * @param {number} normalizedY - Y coordinate in 0-999 range
 * @param {number} viewportWidth - Current viewport width in pixels
 * @param {number} viewportHeight - Current viewport height in pixels
 * @returns {{x: number, y: number}} Actual pixel coordinates
 */
export function denormalizeCoordinates(normalizedX, normalizedY, viewportWidth, viewportHeight) {
  return {
    x: denormalizeX(normalizedX, viewportWidth),
    y: denormalizeY(normalizedY, viewportHeight)
  };
}

/**
 * Convert actual pixel X coordinate to normalized (0-999)
 * @param {number} pixelX - Actual X coordinate in pixels
 * @param {number} viewportWidth - Current viewport width in pixels
 * @returns {number} Normalized X coordinate (0-999)
 */
export function normalizeX(pixelX, viewportWidth) {
  return Math.round((pixelX / viewportWidth) * NORMALIZED_MAX);
}

/**
 * Convert actual pixel Y coordinate to normalized (0-999)
 * @param {number} pixelY - Actual Y coordinate in pixels
 * @param {number} viewportHeight - Current viewport height in pixels
 * @returns {number} Normalized Y coordinate (0-999)
 */
export function normalizeY(pixelY, viewportHeight) {
  return Math.round((pixelY / viewportHeight) * NORMALIZED_MAX);
}

/**
 * Convert actual pixel coordinates to normalized (0-999)
 * @param {number} pixelX - Actual X coordinate in pixels
 * @param {number} pixelY - Actual Y coordinate in pixels
 * @param {number} viewportWidth - Current viewport width in pixels
 * @param {number} viewportHeight - Current viewport height in pixels
 * @returns {{x: number, y: number}} Normalized coordinates (0-999)
 */
export function normalizeCoordinates(pixelX, pixelY, viewportWidth, viewportHeight) {
  return {
    x: normalizeX(pixelX, viewportWidth),
    y: normalizeY(pixelY, viewportHeight)
  };
}

/**
 * Clamp a value to ensure it's within valid bounds
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate that normalized coordinates are within valid range
 * @param {number} x - Normalized X coordinate
 * @param {number} y - Normalized Y coordinate
 * @returns {boolean} True if coordinates are valid
 */
export function isValidNormalizedCoords(x, y) {
  return x >= 0 && x < NORMALIZED_MAX && y >= 0 && y < NORMALIZED_MAX;
}

/**
 * Validate that pixel coordinates are within viewport
 * @param {number} x - Pixel X coordinate
 * @param {number} y - Pixel Y coordinate
 * @param {number} viewportWidth - Current viewport width in pixels
 * @param {number} viewportHeight - Current viewport height in pixels
 * @returns {boolean} True if coordinates are within viewport
 */
export function isWithinViewport(x, y, viewportWidth, viewportHeight) {
  return x >= 0 && x < viewportWidth && y >= 0 && y < viewportHeight;
}
