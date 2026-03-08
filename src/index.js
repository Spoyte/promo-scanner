/**
 * @fileoverview Promo Scanner API Server
 * @description Screenshot-based promotion detection for bookmakers
 * @module promo-scanner/server
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const PromoTracker = require('./tracker');

const app = express();
const tracker = new PromoTracker({ dataDir: './data' });

// Track server start time for health checks
const serverStartTime = new Date();

// Middleware
app.use(express.json());
app.use(express.static('web'));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Multer setup for image uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

// Ensure uploads directory exists
(async () => {
  try {
    await fs.mkdir('uploads', { recursive: true });
  } catch (err) {
    console.error('Failed to create uploads directory:', err.message);
  }
})();

/**
 * @route POST /api/upload
 * @description Upload screenshot and extract promotions
 * @param {file} screenshot - Image file to analyze
 * @returns {Object} Extraction results
 */
app.post('/api/upload', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No screenshot provided',
        message: 'Please provide an image file in the "screenshot" field'
      });
    }

    // Read image
    const imageBuffer = await fs.readFile(req.file.path);
    
    // Extract text using vision (placeholder - would use actual vision API)
    const extractedData = await extractPromotionsFromImage(imageBuffer);
    
    // Clean up temp file
    try {
      await fs.unlink(req.file.path);
    } catch (err) {
      console.warn('Failed to clean up temp file:', err.message);
    }
    
    // Save to tracker
    const savedPromotions = [];
    for (const promo of extractedData) {
      try {
        const saved = await tracker.addPromotion({ ...promo, source: 'screenshot' });
        savedPromotions.push(saved);
      } catch (err) {
        console.warn('Failed to save promotion:', err.message);
      }
    }
    
    res.json({
      success: true,
      extracted: extractedData.length,
      saved: savedPromotions.length,
      promotions: savedPromotions,
      message: extractedData.length === 0 
        ? 'No promotions detected. Try manual entry.' 
        : `Extracted ${extractedData.length} promotion(s)`
    });
  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to process image'
    });
  }
});

/**
 * @route POST /api/promotions
 * @description Manually add a promotion
 * @param {string} bookmaker - Bookmaker name
 * @param {string} event - Event name
 * @param {string} selection - Selection/bet
 * @param {number} originalOdds - Original odds
 * @param {number} boostedOdds - Boosted odds
 * @param {string} [expiry] - Expiry date (ISO string)
 * @returns {Object} Created promotion
 */
app.post('/api/promotions', async (req, res) => {
  try {
    const promo = await tracker.addPromotion(req.body);
    res.json({ success: true, promotion: promo });
  } catch (error) {
    console.error('Error adding promotion:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * @route GET /api/promotions
 * @description Get all active promotions
 * @param {string} [bookmaker] - Filter by bookmaker
 * @param {string} [event] - Filter by event
 * @param {number} [minBoost] - Minimum boost percentage
 * @returns {Array} List of promotions
 */
app.get('/api/promotions', async (req, res) => {
  try {
    const filters = {
      bookmaker: req.query.bookmaker,
      event: req.query.event,
      minBoost: req.query.minBoost ? parseFloat(req.query.minBoost) : undefined
    };
    
    const promos = await tracker.getActivePromotions(filters);
    res.json({
      success: true,
      count: promos.length,
      promotions: promos
    });
  } catch (error) {
    console.error('Error fetching promotions:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * @route GET /api/promotions/:id
 * @description Get a specific promotion by ID
 * @param {string} id - Promotion ID
 * @returns {Object} Promotion details
 */
app.get('/api/promotions/:id', async (req, res) => {
  try {
    const promo = await tracker.getById(req.params.id);
    if (!promo) {
      return res.status(404).json({
        success: false,
        error: 'Promotion not found'
      });
    }
    res.json({ success: true, promotion: promo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route DELETE /api/promotions/:id
 * @description Delete a promotion by ID
 * @param {string} id - Promotion ID
 * @returns {Object} Deletion result
 */
app.delete('/api/promotions/:id', async (req, res) => {
  try {
    const deleted = await tracker.deleteById(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Promotion not found'
      });
    }
    res.json({ 
      success: true, 
      message: 'Promotion deleted',
      id: req.params.id
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route GET /api/opportunities
 * @description Get +EV opportunities from promotions
 * @param {number} [minEV] - Minimum expected value percentage
 * @returns {Array} List of opportunities
 */
app.get('/api/opportunities', async (req, res) => {
  try {
    const options = {
      minEV: req.query.minEV ? parseFloat(req.query.minEV) : 0
    };
    
    const opportunities = await tracker.findOpportunities(options);
    res.json({
      success: true,
      count: opportunities.length,
      opportunities
    });
  } catch (error) {
    console.error('Error finding opportunities:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * @route GET /api/stats
 * @description Get promotion statistics
 * @returns {Object} Statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await tracker.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route GET /api/export
 * @description Export all promotions
 * @returns {Object} Full export data
 */
app.get('/api/export', async (req, res) => {
  try {
    const data = await tracker.export();
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route GET /health
 * @description Health check endpoint
 * @returns {Object} Health status
 */
app.get('/health', (req, res) => {
  const uptime = Math.floor((new Date() - serverStartTime) / 1000);
  res.json({
    status: 'ok',
    uptime,
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /
 * @description Main dashboard page
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

/**
 * Placeholder for vision-based promotion extraction
 * @param {Buffer} imageBuffer - Image data
 * @returns {Promise<Array>} Extracted promotions
 * @todo Implement actual vision API integration
 */
async function extractPromotionsFromImage(imageBuffer) {
  // In production, this would call a vision API (OpenAI, Google Vision, etc.)
  // For now, return empty array to indicate manual entry is needed
  console.log('Vision extraction not implemented - manual entry required');
  return [];
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎯 Promo Scanner running on port ${PORT}`);
  console.log(`   Data directory: ${tracker.dataDir}`);
});

module.exports = app;
