/**
 * @fileoverview Promo Tracker - Manages bookmaker promotions with persistent storage
 * @module promo-scanner/tracker
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Validates a promotion object
 * @param {Object} promo - The promotion to validate
 * @throws {Error} If validation fails
 */
function validatePromotion(promo) {
  const required = ['bookmaker', 'event', 'selection', 'originalOdds', 'boostedOdds'];
  const missing = required.filter(field => promo[field] == null);
  
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
  
  if (typeof promo.originalOdds !== 'number' || promo.originalOdds <= 0) {
    throw new Error('originalOdds must be a positive number');
  }
  
  if (typeof promo.boostedOdds !== 'number' || promo.boostedOdds <= 0) {
    throw new Error('boostedOdds must be a positive number');
  }
  
  if (promo.expiry && isNaN(Date.parse(promo.expiry))) {
    throw new Error('expiry must be a valid date string');
  }
}

/**
 * Tracks bookmaker promotions with persistent storage
 * @class
 */
class PromoTracker {
  /**
   * Creates a new PromoTracker instance
   * @param {Object} options - Configuration options
   * @param {string} [options.dataDir='./data'] - Directory for data storage
   * @param {string} [options.filename='promotions.json'] - Filename for storage
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data';
    this.filename = options.filename || 'promotions.json';
    this.filepath = path.join(this.dataDir, this.filename);
    this.promotions = [];
    this.initialized = false;
  }

  /**
   * Initializes the tracker, loading existing data
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const data = await fs.readFile(this.filepath, 'utf8');
      this.promotions = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Error loading promotions:', err.message);
      }
      this.promotions = [];
    }
    
    this.initialized = true;
  }

  /**
   * Persists current promotions to disk
   * @returns {Promise<void>}
   * @private
   */
  async _persist() {
    await fs.writeFile(
      this.filepath,
      JSON.stringify(this.promotions, null, 2),
      'utf8'
    );
  }

  /**
   * Adds a new promotion
   * @param {Object} promo - The promotion to add
   * @param {string} promo.bookmaker - Bookmaker name (e.g., 'Winamax', 'Unibet')
   * @param {string} promo.event - Event name (e.g., 'PSG vs Marseille')
   * @param {string} promo.selection - Selection (e.g., 'PSG Win')
   * @param {number} promo.originalOdds - Original odds before boost
   * @param {number} promo.boostedOdds - Boosted odds
   * @param {string} [promo.expiry] - ISO date string when promotion expires
   * @param {string} [promo.source='manual'] - Source of promotion ('screenshot' or 'manual')
   * @returns {Promise<Object>} The created promotion with ID
   * @throws {Error} If validation fails
   */
  async addPromotion(promo) {
    await this.init();
    validatePromotion(promo);
    
    const promotion = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bookmaker: String(promo.bookmaker).trim(),
      event: String(promo.event).trim(),
      selection: String(promo.selection).trim(),
      originalOdds: Number(promo.originalOdds),
      boostedOdds: Number(promo.boostedOdds),
      boostPercent: this.calculateBoost(promo.originalOdds, promo.boostedOdds),
      expiry: promo.expiry || null,
      addedAt: new Date().toISOString(),
      source: promo.source || 'manual'
    };
    
    this.promotions.push(promotion);
    await this._persist();
    
    return promotion;
  }

  /**
   * Calculates the boost percentage
   * @param {number} original - Original odds
   * @param {number} boosted - Boosted odds
   * @returns {number} Boost percentage
   */
  calculateBoost(original, boosted) {
    if (!original || !boosted || original <= 0) return 0;
    return ((boosted / original) - 1) * 100;
  }

  /**
   * Gets active (non-expired) promotions
   * @param {Object} filters - Filter options
   * @param {string} [filters.bookmaker] - Filter by bookmaker
   * @param {string} [filters.event] - Filter by event
   * @param {number} [filters.minBoost] - Minimum boost percentage
   * @returns {Promise<Array>} Array of active promotions
   */
  async getActivePromotions(filters = {}) {
    await this.init();
    
    const now = new Date().toISOString();
    let active = this.promotions.filter(p => !p.expiry || p.expiry > now);
    
    if (filters.bookmaker) {
      active = active.filter(p => 
        p.bookmaker.toLowerCase() === filters.bookmaker.toLowerCase()
      );
    }
    
    if (filters.event) {
      active = active.filter(p => 
        p.event.toLowerCase().includes(filters.event.toLowerCase())
      );
    }
    
    if (filters.minBoost != null) {
      active = active.filter(p => p.boostPercent >= filters.minBoost);
    }
    
    return active.sort((a, b) => b.boostPercent - a.boostPercent);
  }

  /**
   * Finds +EV opportunities by comparing against fair odds
   * @param {Object} options - Options for finding opportunities
   * @param {number} [options.minEV=0] - Minimum expected value percentage
   * @returns {Promise<Array>} Array of opportunities with EV estimates
   */
  async findOpportunities(options = {}) {
    await this.init();
    
    const minEV = options.minEV || 0;
    const promos = await this.getActivePromotions();
    
    return promos
      .map(p => ({
        ...p,
        potentialEV: this.estimateEV(p.boostedOdds, p.originalOdds),
        recommendation: this.getRecommendation(p)
      }))
      .filter(p => parseFloat(p.potentialEV) >= minEV)
      .sort((a, b) => parseFloat(b.potentialEV) - parseFloat(a.potentialEV));
  }

  /**
   * Estimates the expected value of a promotion
   * @param {number} boostedOdds - The boosted odds offered
   * @param {number} originalOdds - The original (fair) odds
   * @returns {string} Estimated EV as percentage string
   */
  estimateEV(boostedOdds, originalOdds) {
    if (!boostedOdds || !originalOdds || originalOdds <= 0) return '0.00';
    // Rough EV estimate assuming original odds are fair
    const trueProb = 1 / originalOdds;
    const ev = (boostedOdds * trueProb) - 1;
    return (ev * 100).toFixed(2);
  }

  /**
   * Gets a recommendation for a promotion
   * @param {Object} promo - The promotion
   * @returns {string} Recommendation ('strong', 'consider', 'skip')
   * @private
   */
  getRecommendation(promo) {
    const ev = parseFloat(this.estimateEV(promo.boostedOdds, promo.originalOdds));
    if (ev > 10) return 'strong';
    if (ev > 5) return 'consider';
    return 'skip';
  }

  /**
   * Gets a promotion by ID
   * @param {string} id - The promotion ID
   * @returns {Promise<Object|null>} The promotion or null if not found
   */
  async getById(id) {
    await this.init();
    return this.promotions.find(p => p.id === id) || null;
  }

  /**
   * Deletes a promotion by ID
   * @param {string} id - The promotion ID to delete
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteById(id) {
    await this.init();
    const index = this.promotions.findIndex(p => p.id === id);
    if (index === -1) return false;
    
    this.promotions.splice(index, 1);
    await this._persist();
    return true;
  }

  /**
   * Exports all promotions
   * @returns {Promise<Object>} Export object with metadata
   */
  async export() {
    await this.init();
    const active = await this.getActivePromotions();
    
    return {
      promotions: this.promotions,
      count: this.promotions.length,
      activeCount: active.length,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Gets statistics about tracked promotions
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    await this.init();
    const active = await this.getActivePromotions();
    const expired = this.promotions.filter(p => p.expiry && p.expiry < new Date().toISOString());
    
    const byBookmaker = active.reduce((acc, p) => {
      acc[p.bookmaker] = (acc[p.bookmaker] || 0) + 1;
      return acc;
    }, {});
    
    const avgBoost = active.length > 0
      ? active.reduce((sum, p) => sum + p.boostPercent, 0) / active.length
      : 0;
    
    return {
      total: this.promotions.length,
      active: active.length,
      expired: expired.length,
      byBookmaker,
      averageBoost: avgBoost.toFixed(2),
      topBoost: active.length > 0 ? Math.max(...active.map(p => p.boostPercent)).toFixed(2) : 0
    };
  }
}

module.exports = PromoTracker;
