/**
 * Proxy ID Cache System
 *
 * In-memory cache for unsubscribe proxy IDs stored in Excel Location column.
 * Provides fast lookups (1-5ms) instead of reading Excel file every time (3-7 seconds).
 *
 * Cache refreshes automatically every 5 minutes to stay in sync with Excel.
 */

const { getLeadsViaGraphAPI } = require('./excelGraphAPI');
const { parseLocationToken } = require('./proxyIdManager');

class ProxyIdCache {
    constructor() {
        // Map: proxyId => { email, expiry, used }
        this.cache = new Map();
        this.cacheTimestamp = null;
        this.cacheRefreshInterval = 5 * 60 * 1000; // 5 minutes
        this.isRefreshing = false;
    }

    /**
     * Get token data by proxy ID (with automatic cache refresh)
     * @param {string} proxyId - The proxy ID to look up
     * @param {Object} graphClient - Microsoft Graph client for Excel access
     * @returns {Promise<Object|null>} Token data or null if not found/invalid
     */
    async getTokenData(proxyId, graphClient) {
        // Refresh cache if needed (first access or older than 5 minutes)
        if (this._needsRefresh()) {
            await this.refreshCache(graphClient);
        }

        const tokenData = this.cache.get(proxyId);

        if (!tokenData) {
            console.log(`❌ [PROXY-CACHE] Proxy ID not found: ${proxyId}`);
            return null;
        }

        console.log(`✅ [PROXY-CACHE] Found: ${proxyId} → ${tokenData.email}`);
        return tokenData;
    }

    /**
     * Refresh cache from Excel
     * @param {Object} graphClient - Microsoft Graph client
     */
    async refreshCache(graphClient) {
        if (this.isRefreshing) {
            console.log(`⏳ [PROXY-CACHE] Refresh already in progress, waiting...`);
            // Wait for current refresh to complete
            while (this.isRefreshing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        this.isRefreshing = true;

        try {
            console.log(`🔄 [PROXY-CACHE] Refreshing cache from Excel...`);
            const startTime = Date.now();

            // Read all leads from Excel
            const leads = await getLeadsViaGraphAPI(graphClient);

            // Clear old cache
            this.cache.clear();

            // Parse Location column for each lead and build cache
            let validTokens = 0;
            let expiredTokens = 0;
            let usedTokens = 0;

            for (const lead of leads) {
                if (!lead.Location || !lead.Location.startsWith('TOKEN:')) {
                    continue; // Skip rows without tokens
                }

                const tokenData = parseLocationToken(lead.Location);
                if (!tokenData) {
                    console.warn(`⚠️  [PROXY-CACHE] Invalid token format for ${lead.Email}: ${lead.Location}`);
                    continue;
                }

                // Store in cache regardless of status (for diagnostics)
                this.cache.set(tokenData.proxyId, {
                    email: lead.Email,
                    expiry: tokenData.expiry,
                    used: tokenData.used
                });

                // Count token status
                if (tokenData.used) {
                    usedTokens++;
                } else if (tokenData.expiry < new Date()) {
                    expiredTokens++;
                } else {
                    validTokens++;
                }
            }

            this.cacheTimestamp = Date.now();
            const refreshTime = Date.now() - startTime;

            console.log(`✅ [PROXY-CACHE] Refresh complete in ${refreshTime}ms`);
            console.log(`📊 [PROXY-CACHE] Stats: ${validTokens} valid, ${expiredTokens} expired, ${usedTokens} used (${this.cache.size} total)`);

        } catch (error) {
            console.error(`❌ [PROXY-CACHE] Refresh failed:`, error.message);
            // Don't throw - keep using old cache if refresh fails
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Check if cache needs refresh
     * @returns {boolean} True if cache should be refreshed
     * @private
     */
    _needsRefresh() {
        if (!this.cacheTimestamp) {
            console.log(`🔍 [PROXY-CACHE] First access - cache empty`);
            return true;
        }

        const cacheAge = Date.now() - this.cacheTimestamp;
        if (cacheAge > this.cacheRefreshInterval) {
            console.log(`🔍 [PROXY-CACHE] Cache stale (${Math.round(cacheAge / 1000)}s old) - refreshing`);
            return true;
        }

        const cacheAgeSeconds = Math.round(cacheAge / 1000);
        console.log(`✅ [PROXY-CACHE] Cache fresh (${cacheAgeSeconds}s old, ${this.cache.size} entries)`);
        return false;
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        const cacheAge = this.cacheTimestamp ? Date.now() - this.cacheTimestamp : null;

        return {
            size: this.cache.size,
            ageSeconds: cacheAge ? Math.round(cacheAge / 1000) : null,
            lastRefresh: this.cacheTimestamp ? new Date(this.cacheTimestamp).toISOString() : null,
            isRefreshing: this.isRefreshing
        };
    }
}

// Singleton instance
const proxyIdCache = new ProxyIdCache();

module.exports = proxyIdCache;
