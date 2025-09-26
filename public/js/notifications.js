/**
 * Frontend Notification System
 * Handles real-time notifications from the server, especially authentication failures
 */

class NotificationSystem {
    constructor() {
        this.pollInterval = 30000; // Poll every 30 seconds
        this.isPolling = false;
        this.sessionId = this.getSessionId();
        this.notificationContainer = null;

        this.init();
    }

    init() {
        // Create notification container
        this.createNotificationContainer();

        // Start polling for notifications
        this.startPolling();

        console.log('🔔 Notification system initialized');
    }

    getSessionId() {
        // Try to get session ID from various sources
        const sessionId = localStorage.getItem('sessionId') ||
                         sessionStorage.getItem('sessionId') ||
                         this.generateSessionId();

        // Store in localStorage for persistence
        localStorage.setItem('sessionId', sessionId);
        return sessionId;
    }

    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
    }

    createNotificationContainer() {
        // Create notification container if it doesn't exist
        if (!document.getElementById('notification-container')) {
            const container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 400px;
            `;
            document.body.appendChild(container);
            this.notificationContainer = container;
        } else {
            this.notificationContainer = document.getElementById('notification-container');
        }
    }

    async startPolling() {
        if (this.isPolling) return;

        this.isPolling = true;
        console.log('🔄 Started polling for notifications');

        const poll = async () => {
            try {
                await this.checkForNotifications();
            } catch (error) {
                console.error('❌ Notification polling error:', error);
            }

            if (this.isPolling) {
                setTimeout(poll, this.pollInterval);
            }
        };

        // Initial poll
        await poll();
    }

    stopPolling() {
        this.isPolling = false;
        console.log('🔕 Stopped polling for notifications');
    }

    async checkForNotifications() {
        try {
            const response = await fetch('/api/notifications/poll', {
                method: 'GET',
                headers: {
                    'X-Session-Id': this.sessionId,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success && data.notifications && data.notifications.length > 0) {
                console.log(`🔔 Received ${data.notifications.length} notifications`);

                data.notifications.forEach(notification => {
                    this.showNotification(notification);
                });
            }

        } catch (error) {
            // Silent fail for network errors to avoid spam
            console.debug('Notification polling error:', error.message);
        }
    }

    showNotification(notification) {
        const notificationElement = this.createNotificationElement(notification);
        this.notificationContainer.appendChild(notificationElement);

        // Auto-focus for critical notifications
        if (notification.severity === 'critical') {
            notificationElement.scrollIntoView({ behavior: 'smooth' });
        }

        // Auto-dismiss non-persistent notifications after 10 seconds
        if (!notification.persistent) {
            setTimeout(() => {
                this.dismissNotification(notificationElement);
            }, 10000);
        }
    }

    createNotificationElement(notification) {
        const element = document.createElement('div');
        element.className = `notification notification-${notification.severity || 'info'}`;

        // Determine colors based on severity
        let bgColor, borderColor, textColor;
        switch (notification.severity) {
            case 'critical':
                bgColor = '#f8d7da';
                borderColor = '#f5c6cb';
                textColor = '#721c24';
                break;
            case 'warning':
                bgColor = '#fff3cd';
                borderColor = '#ffeaa7';
                textColor = '#856404';
                break;
            case 'success':
                bgColor = '#d4edda';
                borderColor = '#c3e6cb';
                textColor = '#155724';
                break;
            default:
                bgColor = '#d1ecf1';
                borderColor = '#bee5eb';
                textColor = '#0c5460';
        }

        element.style.cssText = `
            background: ${bgColor};
            border: 1px solid ${borderColor};
            color: ${textColor};
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            animation: slideIn 0.3s ease-out;
        `;

        // Add CSS animation keyframe if not exists
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .notification-button {
                    background: #007bff;
                    color: white;
                    border: none;
                    padding: 8px 15px;
                    border-radius: 3px;
                    cursor: pointer;
                    margin: 5px 5px 0 0;
                    text-decoration: none;
                    display: inline-block;
                    font-size: 12px;
                }
                .notification-button:hover {
                    background: #0056b3;
                }
                .notification-button.secondary {
                    background: #6c757d;
                }
                .notification-button.secondary:hover {
                    background: #545b62;
                }
            `;
            document.head.appendChild(style);
        }

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1;">
                    <strong>${notification.type || 'Notification'}</strong>
                    <p style="margin: 5px 0;">${notification.message}</p>
        `;

        if (notification.details) {
            html += `
                <div style="font-size: 11px; margin-top: 5px; opacity: 0.8;">
                    <div>Time: ${new Date(notification.timestamp).toLocaleString()}</div>
                    ${notification.details.userEmail ? `<div>User: ${notification.details.userEmail}</div>` : ''}
                </div>
            `;
        }

        if (notification.actions && notification.actions.length > 0) {
            html += '<div style="margin-top: 10px;">';
            notification.actions.forEach(action => {
                const buttonClass = action.style === 'primary' ? 'notification-button' : 'notification-button secondary';
                if (action.url) {
                    html += `<a href="${action.url}" class="${buttonClass}" onclick="window.notificationSystem.dismissNotification(this.closest('.notification'))">${action.text}</a>`;
                } else {
                    html += `<button class="${buttonClass}" onclick="${action.onclick || ''}">${action.text}</button>`;
                }
            });
            html += '</div>';
        }

        html += `
                </div>
                <button style="background: none; border: none; font-size: 18px; cursor: pointer; color: ${textColor}; opacity: 0.7;" onclick="window.notificationSystem.dismissNotification(this.closest('.notification'))">&times;</button>
            </div>
        `;

        element.innerHTML = html;
        return element;
    }

    dismissNotification(element) {
        if (element && element.parentNode) {
            element.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }, 300);
        }
    }

    // Test notification (for debugging)
    showTestNotification() {
        const testNotification = {
            type: 'AUTH_FAILURE',
            message: 'Authentication expired during email campaign - Test notification',
            severity: 'critical',
            timestamp: new Date().toISOString(),
            actions: [{
                text: 'Re-authenticate Now',
                url: '/auth/login',
                style: 'primary'
            }, {
                text: 'Dismiss',
                style: 'secondary'
            }],
            details: {
                userEmail: 'test@example.com'
            },
            persistent: true
        };

        this.showNotification(testNotification);
    }
}

// Initialize notification system when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.notificationSystem = new NotificationSystem();

    // Add test method to console for debugging
    window.testNotification = () => window.notificationSystem.showTestNotification();

    console.log('🔔 Run testNotification() in console to test notifications');
});