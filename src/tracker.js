/**
 * Tracks bookmaker promotions from screenshots
 */
class PromoTracker {
  constructor() {
    this.promotions = [];
  }

  addPromotion(promo) {
    const promotion = {
      id: Date.now().toString(),
      bookmaker: promo.bookmaker,
      event: promo.event,
      selection: promo.selection,
      originalOdds: promo.originalOdds,
      boostedOdds: promo.boostedOdds,
      boostPercent: this.calculateBoost(promo.originalOdds, promo.boostedOdds),
      expiry: promo.expiry,
      addedAt: new Date().toISOString(),
      source: promo.source || 'manual' // 'screenshot' or 'manual'
    };
    
    this.promotions.push(promotion);
    return promotion;
  }

  calculateBoost(original, boosted) {
    return ((boosted / original) - 1) * 100;
  }

  getActivePromotions(bookmaker = null) {
    const now = new Date().toISOString();
    let active = this.promotions.filter(p => !p.expiry || p.expiry > now);
    
    if (bookmaker) {
      active = active.filter(p => p.bookmaker === bookmaker);
    }
    
    return active.sort((a, b) => b.boostPercent - a.boostPercent);
  }

  async findOpportunities() {
    // Compare promotions against Pinnacle odds
    // This would integrate with the Odds API
    const promos = this.getActivePromotions();
    
    return promos.map(p => ({
      ...p,
      potentialEV: this.estimateEV(p.boostedOdds, p.originalOdds)
    }));
  }

  estimateEV(boostedOdds, originalOdds) {
    // Rough EV estimate assuming original odds are fair
    const trueProb = 1 / originalOdds;
    const ev = (boostedOdds * trueProb) - 1;
    return (ev * 100).toFixed(2);
  }

  export() {
    return {
      promotions: this.promotions,
      count: this.promotions.length,
      exportedAt: new Date().toISOString()
    };
  }
}

module.exports = PromoTracker;
