// Import OSC Query Server components for discovering and announcing OSC services
const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('./lib/OSCQueryServer');
// Import node-osc for handling OSC (Open Sound Control) messages via UDP
const osc = require('node-osc');
// Import Bonjour for mDNS (multicast DNS) service discovery and announcement
const Bonjour = require('bonjour-service');

/**
 * VRChatOSCQuery - Main class for creating an OSC Query server compatible with VRChat
 * 
 * This class provides a complete OSC Query implementation that allows VRChat and other
 * OSC-compatible applications to discover and communicate with your JavaScript application.
 * 
 * Key Features:
 * - OSC Query HTTP server for service discovery
 * - OSC UDP server for receiving real-time data from VRChat
 * - mDNS service advertisement for automatic discovery
 * - Path subscription system for filtering incoming messages
 * - VRChat-specific parameter handling (avatar, chatbox, input)
 * 
 * Usage in your own project:
 * const VRChatOSCQuery = require('./Main.js');
 * const oscServer = new VRChatOSCQuery("MyApp");
 * oscServer.start();
 */
class VRChatOSCQuery {
    /**
     * Constructor - Initialize a new VRChat OSC Query server
     * @param {string} appName - The name of your application (displayed in VRChat's OSC debug)
     */
    constructor(appName = "VRChat-OSC-JS") {
        this.appName = appName; // Application name for identification
        this.oscPort = this.getRandomPort(22000, 50000); // Random UDP port for OSC messages
        this.httpPort = this.getRandomPort(22000, 50000); // Random TCP port for HTTP API
        this.subscribedPaths = new Set(); // Set of OSC paths to listen for
        this.subscribeToAll = true; // Default to subscribe to all paths (recommended for VRChat)
        
        // Initialize OSC Query Server - This creates the HTTP server that announces OSC capabilities
        // VRChat uses this to discover your application and understand what OSC parameters it supports
        this.oscQueryServer = new OSCQueryServer({
            httpPort: this.httpPort, // HTTP port for OSC Query API
            oscPort: this.oscPort, // UDP port where we receive OSC messages
            oscQueryHostName: this.appName, // Name displayed in VRChat's OSC debug
            serviceName: this.appName, // Name used for mDNS service advertisement
            rootDescription: `${this.appName} - VRChat OSC Query Server`, // Description of the service
            oscTransport: "UDP" // Transport protocol for OSC messages (UDP is standard)
        });
        
        // Initialize OSC Server for receiving data - This is the actual UDP server that receives messages
        this.oscServer = null;
        
        // Initialize Bonjour for mDNS discovery trigger - Used to "wake up" the network discovery
        this.bonjour = new Bonjour.Bonjour();
        
        console.log(`[${this.appName}] Initializing with OSC Port: ${this.oscPort}, HTTP Port: ${this.httpPort}`);
    }

    /**
     * Trigger mDNS discovery to make VRChat aware of our presence
     * 
     * This function performs a brief network scan which "wakes up" the mDNS network
     * and makes VRChat become aware of OSC Query services on the network.
     * This is particularly important on Windows where mDNS discovery can be delayed.
     */
    triggerMDNSDiscovery() {
        console.log(`[${this.appName}] Triggering mDNS discovery to activate VRChat awareness...`);
        
        // Perform a brief scan for OSCQuery services - this "wakes up" the mDNS network
        // and makes VRChat aware of our presence
        this.bonjour.find({ type: 'oscjson' }, (service) => {
            console.log(`[${this.appName}] Found OSCQuery service during discovery trigger: ${service.name}`);
        });
        
        // Stop the discovery after a short time to avoid unnecessary network traffic
        setTimeout(() => {
            try {
                this.bonjour.unpublishAll();
                console.log(`[${this.appName}] mDNS discovery trigger completed`);
            } catch (error) {
                // Ignore errors during cleanup - this is just a discovery trigger
            }
        }, 1000);
    }

    /**
     * Generate a random port number within a specified range
     * @param {number} min - Minimum port number
     * @param {number} max - Maximum port number
     * @returns {number} Random port number within range
     */
    getRandomPort(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Setup the OSC UDP server to receive messages from VRChat
     * 
     * This creates a UDP server that listens for OSC messages sent by VRChat.
     * All incoming messages are filtered through the subscription system before processing.
     */
    setupOSCServer() {
        // Create OSC server listening on the specified port and all network interfaces
        this.oscServer = new osc.Server(this.oscPort, '0.0.0.0', () => {
            console.log(`[${this.appName}] OSC Server listening on UDP port ${this.oscPort}`);
        });

        // Handle incoming OSC messages
        this.oscServer.on('message', (msg) => {
            const [address, ...values] = msg; // Destructure OSC message: [address, value1, value2, ...]
            
            // Check if we should process this message based on subscriptions
            if (this.shouldProcessMessage(address)) {
                this.handleOSCMessage(address, values);
            }
        });

        // Handle OSC server errors
        this.oscServer.on('error', (err) => {
            console.error(`[${this.appName}] OSC Server Error:`, err);
        });
    }

    /**
     * Determine if an OSC message should be processed based on subscription settings
     * @param {string} address - The OSC address path (e.g., "/avatar/parameters/VRCEmote")
     * @returns {boolean} True if the message should be processed
     */
    shouldProcessMessage(address) {
        // If subscribed to all paths, process everything
        if (this.subscribeToAll) {
            return true;
        }
        
        // Check if the address matches any of our subscribed paths
        for (const subscribedPath of this.subscribedPaths) {
            if (this.pathMatches(address, subscribedPath)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if an OSC address matches a subscription pattern
     * @param {string} address - The actual OSC address from the message
     * @param {string} pattern - The subscription pattern to match against
     * @returns {boolean} True if the address matches the pattern
     */
    pathMatches(address, pattern) {
        // Handle exact match
        if (pattern === address) {
            return true;
        }
        
        // Handle wildcard patterns like /avatar/parameters/(!?vrcft)
        // This excludes paths containing the specified string
        if (pattern.includes('(!?')) {
            const basePattern = pattern.split('(!?')[0];
            const excludePattern = pattern.split('(!?')[1].replace(')', '');
            
            if (address.startsWith(basePattern) && !address.includes(excludePattern)) {
                return true;
            }
        }
        
        // Handle simple prefix matching with asterisk wildcard
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return address.startsWith(prefix);
        }
        
        return false;
    }

    /**
     * Main message handler for incoming OSC messages
     * 
     * This function routes OSC messages to appropriate handlers based on their address.
     * Override this method in subclasses to add custom message handling logic.
     * 
     * @param {string} address - The OSC address path
     * @param {Array} values - Array of values sent with the message
     */
    handleOSCMessage(address, values) {
        console.log(`[${this.appName}] Received OSC: ${address} ->`, values);
        
        // Route messages to specific handlers based on VRChat's OSC structure
        if (address.startsWith('/avatar/parameters/')) {
            this.handleAvatarParameter(address, values);
        } else if (address.startsWith('/chatbox/')) {
            this.handleChatbox(address, values);
        } else if (address.startsWith('/input/')) {
            this.handleInput(address, values);
        }
        // Add more routing logic here for other VRChat OSC paths
    }

    /**
     * Handle VRChat avatar parameter changes
     * 
     * VRChat sends avatar parameter updates to /avatar/parameters/{parameterName}
     * Common parameters include: VRCEmote, VRCFaceBlendH, VRCFaceBlendV, etc.
     * 
     * @param {string} address - The full OSC address
     * @param {Array} values - Parameter values (usually a single float, int, or bool)
     */
    handleAvatarParameter(address, values) {
        const paramName = address.replace('/avatar/parameters/', ''); // Extract parameter name
        // Add your custom avatar parameter handling logic here
        // Example: Update UI, trigger animations, send to external APIs, etc.
    }

    /**
     * Handle VRChat chatbox messages
     * 
     * VRChat sends chatbox input to /chatbox/input with text and typing indicator
     * 
     * @param {string} address - The OSC address
     * @param {Array} values - [message_text, typing_indicator]
     */
    handleChatbox(address, values) {
        console.log(`[${this.appName}] Chatbox Message:`, values[0]);
        // Add your custom chatbox handling logic here
        // Example: Log messages, trigger responses, integrate with chat bots, etc.
    }

    /**
     * Handle VRChat input controls
     * 
     * VRChat sends input state changes to various /input/ paths
     * Examples: /input/Jump, /input/MoveForward, /input/LookHorizontal
     * 
     * @param {string} address - The OSC address
     * @param {Array} values - Input values (typically floats or bools)
     */
    handleInput(address, values) {
        console.log(`[${this.appName}] Input:`, address, values);
        // Add your custom input handling logic here
        // Example: Control external devices, trigger game events, etc.
    }

    /**
     * Subscribe to a specific OSC path pattern
     * 
     * When you subscribe to specific paths, the server will only process messages
     * that match your subscriptions. This can improve performance for applications
     * that only need specific VRChat data.
     * 
     * @param {string} path - OSC path pattern to subscribe to
     */
    subscribe(path) {
        this.subscribeToAll = false; // Disable subscribe-to-all mode
        this.subscribedPaths.add(path);
        console.log(`[${this.appName}] Subscribed to path: ${path}`);
    }

    /**
     * Unsubscribe from a specific OSC path pattern
     * @param {string} path - OSC path pattern to unsubscribe from
     */
    unsubscribe(path) {
        this.subscribedPaths.delete(path);
        console.log(`[${this.appName}] Unsubscribed from path: ${path}`);
        
        // If no subscriptions left, revert to subscribing to all
        if (this.subscribedPaths.size === 0) {
            this.subscribeToAll = true;
            console.log(`[${this.appName}] No more subscriptions, reverting to subscribe all`);
        }
    }

    /**
     * Enable subscription to all OSC paths (default behavior)
     * 
     * This is the recommended mode for most VRChat applications as it ensures
     * you receive all available data from VRChat.
     */
    subscribeToAllPaths() {
        this.subscribeToAll = true;
        this.subscribedPaths.clear();
        console.log(`[${this.appName}] Now subscribing to all paths`);
    }
    /**
     * Setup OSC Query endpoints that VRChat can discover
     * 
     * This function defines the OSC parameters that your application supports.
     * VRChat uses this information to understand what data it can send to your app.
     * These endpoints appear in VRChat's OSC debug menu.
     */
    setupOSCQueryEndpoints() {
        // Add avatar parameters endpoint - VRChat sends avatar parameter changes here
        this.oscQueryServer.addMethod('/avatar/parameters', {
            description: 'VRChat Avatar Parameters - Receives avatar parameter updates like facial expressions, emotes, and custom parameters',
            access: OSCQAccess.WRITEONLY, // VRChat writes to this, we only read
        });

        // Add chatbox input endpoint - VRChat sends chat messages here
        this.oscQueryServer.addMethod('/chatbox/input', {
            description: 'VRChat Chatbox Input - Receives text input and typing indicator from VRChat chatbox',
            access: OSCQAccess.WRITEONLY, // VRChat writes to this, we only read
            arguments: [
                {
                    type: OSCTypeSimple.STRING, // The chat message text
                },
                {
                    type: OSCTypeSimple.TRUE, // Boolean typing indicator
                }
            ]
        });

        // Add input controls endpoint - VRChat sends input state changes here
        this.oscQueryServer.addMethod('/input', {
            description: 'VRChat Input Controls - Receives input state changes like movement, jumping, and looking',
            access: OSCQAccess.WRITEONLY, // VRChat writes to this, we only read
        });
    }
    /**
     * Start the OSC Query server and begin listening for VRChat
     * 
     * This function initializes both the OSC Query HTTP server (for discovery)
     * and the OSC UDP server (for receiving data). It also triggers mDNS discovery
     * to ensure VRChat becomes aware of the service.
     * 
     * @returns {Promise} Resolves when the server is fully started
     */
    async start() {
        try {
            console.log(`[${this.appName}] Starting VRChat OSC Query Server (Pure JavaScript)...`);
            
            // Setup OSC Query endpoints - Define what parameters VRChat can send to us
            this.setupOSCQueryEndpoints();
            
            // Start OSC Query Server (for discovery) - This allows VRChat to find us
            const hostInfo = await this.oscQueryServer.start();
            console.log(`[${this.appName}] OSC Query Server started:`, hostInfo);
            
            // Start OSC Server (for receiving data) - This receives the actual OSC messages
            this.setupOSCServer();
            
            console.log(`[${this.appName}] Server is ready and discoverable by VRChat!`);
            console.log(`[${this.appName}] OSC Query HTTP Server: http://localhost:${this.httpPort}`);
            console.log(`[${this.appName}] OSC UDP Server: localhost:${this.oscPort}`);
            console.log(`[${this.appName}] Subscribe to all paths: ${this.subscribeToAll}`);
            
            // Trigger mDNS discovery after 2 seconds to activate VRChat awareness
            // This helps ensure VRChat discovers our service quickly
            setTimeout(() => {
                this.triggerMDNSDiscovery();
            }, 2000);
            
        } catch (error) {
            console.error(`[${this.appName}] Failed to start server:`, error);
        }
    }

    /**
     * Stop the OSC Query server and clean up resources
     * 
     * This function gracefully shuts down both servers and cleans up network resources.
     * Always call this before exiting your application to prevent port conflicts.
     * 
     * @returns {Promise} Resolves when the server is fully stopped
     */
    async stop() {
        try {
            console.log(`[${this.appName}] Stopping servers...`);
            
            // Close the OSC UDP server
            if (this.oscServer) {
                this.oscServer.close();
            }
            
            // Clean up bonjour instance and stop mDNS advertisements
            if (this.bonjour) {
                try {
                    this.bonjour.unpublishAll();
                } catch (error) {
                    // Ignore cleanup errors - these are expected during shutdown
                }
            }
            
            // Stop the OSC Query HTTP server
            await this.oscQueryServer.stop();
            console.log(`[${this.appName}] Servers stopped.`);
            
        } catch (error) {
            console.error(`[${this.appName}] Error stopping servers:`, error);
        }
    }
}
// ============================================================================
// EXAMPLE USAGE - How to use this class in your own project
// ============================================================================

// Create and start the server with a custom application name
const vrchatOSC = new VRChatOSCQuery("OSC-Query-JS");

// Handle graceful shutdown on Ctrl+C (SIGINT)
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await vrchatOSC.stop(); // Always clean up before exiting
    process.exit(0);
});

// Handle graceful shutdown on termination (SIGTERM)
process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await vrchatOSC.stop(); // Always clean up before exiting
    process.exit(0);
});

// Start the server and handle any startup errors
vrchatOSC.start().catch(console.error);

// Export the class for use in other modules
// Usage in other files: const VRChatOSCQuery = require('./Main.js');
module.exports = VRChatOSCQuery;