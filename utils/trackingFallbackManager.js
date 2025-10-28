/**
 * Tracking Fallback Manager
 * Handles storing and processing tracking events when authentication sessions are unavailable
 */

const fs = require('fs').promises;
const path = require('path');
const { getDelegatedAuthProvider } = require('../middleware/delegatedGraphAuth');
const excelUpdateQueue = require('./excelUpdateQueue');
const { updateLeadViaGraphAPI } = require('./excelGraphAPI');

class TrackingFallbackManager {
    constructor() {
        this.fallbackDir = path.join(__dirname, '../tracking-fallback');
        this.ensureFallbackDirectory();
    }

    async ensureFallbackDirectory() {
        try {
            await fs.mkdir(this.fallbackDir, { recursive: true });
        } catch (error) {
            console.error('❌ Failed to create tracking fallback directory:', error.message);
        }
    }

    // Store tracking event when no sessions are available
    async storeTrackingEvent(email, eventType = 'read') {
        try {
            const event = {
                email: email,
                eventType: eventType,
                timestamp: new Date().toISOString(),
                date: new Date().toISOString().split('T')[0],
                processed: false
            };

            const filename = `tracking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.json`;
            const filepath = path.join(this.fallbackDir, filename);

            await fs.writeFile(filepath, JSON.stringify(event, null, 2));
            console.log(`📦 Tracking event stored for later processing: ${email} (${eventType})`);
            return true;
        } catch (error) {
            console.error('❌ Failed to store tracking event:', error.message);
            return false;
        }
    }

    // Process stored tracking events when sessions become available
    async processStoredEvents() {
        try {
            const files = await fs.readdir(this.fallbackDir);
            const trackingFiles = files.filter(file => file.startsWith('tracking_') && file.endsWith('.json'));

            if (trackingFiles.length === 0) {
                return { processed: 0, errors: 0 };
            }

            console.log(`📦 Processing ${trackingFiles.length} stored tracking events...`);

            let processed = 0;
            let errors = 0;

            for (const file of trackingFiles) {
                try {
                    const filepath = path.join(this.fallbackDir, file);
                    const data = await fs.readFile(filepath, 'utf8');
                    const event = JSON.parse(data);

                    if (!event.processed) {
                        // Try to process the event now
                        const success = await this.processTrackingEvent(event.email, event.eventType, event.date);

                        if (success) {
                            // Mark as processed and delete file
                            await fs.unlink(filepath);
                            processed++;
                            console.log(`✅ Processed stored tracking event: ${event.email} (${event.eventType})`);
                        } else {
                            errors++;
                        }
                    }
                } catch (fileError) {
                    console.error(`❌ Error processing tracking file ${file}:`, fileError.message);
                    errors++;
                }
            }

            if (processed > 0) {
                console.log(`✅ Processed ${processed} stored tracking events, ${errors} errors`);
            }

            return { processed, errors };
        } catch (error) {
            console.error('❌ Error processing stored tracking events:', error.message);
            return { processed: 0, errors: 1 };
        }
    }

    // Try to process a single tracking event
    async processTrackingEvent(email, eventType, date) {
        try {
            const authProvider = getDelegatedAuthProvider();
            const activeSessions = authProvider.getActiveSessions();
            if (activeSessions.length === 0) {
                return false; // Still no sessions available
            }

            for (const sessionId of activeSessions) {
                try {
                    const graphClient = await authProvider.getGraphClient(sessionId);

                    const updates = {
                        Status: eventType === 'read' ? 'Read' : 'Clicked',
                        Read_Date: date,
                        'Last Updated': require('./dateFormatter').getCurrentFormattedDate()
                    };

                    // Queue Excel update
                    const updateSuccess = await excelUpdateQueue.queueUpdate(
                        email,
                        () => updateLeadViaGraphAPI(graphClient, email, updates),
                        {
                            type: 'fallback-tracking',
                            email: email,
                            source: 'tracking-pixel-fallback',
                            eventType: eventType
                        }
                    );

                    if (updateSuccess) {
                        return true; // Successfully processed
                    }
                } catch (sessionError) {
                    continue; // Try next session
                }
            }

            return false; // Failed to process
        } catch (error) {
            console.error(`❌ Error processing tracking event for ${email}:`, error.message);
            return false;
        }
    }

    // Clean up old stored events (older than 7 days)
    async cleanupOldEvents() {
        try {
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            const now = new Date();
            const files = await fs.readdir(this.fallbackDir);

            let cleanedCount = 0;
            for (const file of files) {
                if (file.startsWith('tracking_') && file.endsWith('.json')) {
                    const filepath = path.join(this.fallbackDir, file);
                    const stats = await fs.stat(filepath);

                    if (now - stats.mtime > maxAge) {
                        await fs.unlink(filepath);
                        cleanedCount++;
                    }
                }
            }

            if (cleanedCount > 0) {
                console.log(`🧹 Cleaned up ${cleanedCount} old tracking fallback files`);
            }
        } catch (error) {
            console.error('❌ Error cleaning up old tracking events:', error.message);
        }
    }
}

module.exports = TrackingFallbackManager;
