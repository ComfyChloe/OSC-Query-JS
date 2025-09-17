const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');
const osc = require('node-osc');
class VRChatOSCQuery {
    constructor(appName = "VRChat-OSC-JS") {
        this.appName = appName;
        this.oscPort = this.getRandomPort(22000, 50000);
        this.httpPort = this.getRandomPort(22000, 50000);
        this.subscribedPaths = new Set();
        this.subscribeToAll = true; // Default to subscribe to all paths
        // Initialize OSC Query Server
        this.oscQueryServer = new OSCQueryServer({
            httpPort: this.httpPort,
            oscPort: this.oscPort,
            oscQueryHostName: this.appName,
            serviceName: this.appName,
            rootDescription: `${this.appName} - VRChat OSC Query Server`,
            oscTransport: "UDP"
        });
        // Initialize OSC Server for receiving data
        this.oscServer = null;
        console.log(`[${this.appName}] Initializing with OSC Port: ${this.oscPort}, HTTP Port: ${this.httpPort}`);
    }
    getRandomPort(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    setupOSCServer() {
        this.oscServer = new osc.Server(this.oscPort, '0.0.0.0', () => {
            console.log(`[${this.appName}] OSC Server listening on UDP port ${this.oscPort}`);
        });
        this.oscServer.on('message', (msg) => {
            const [address, ...values] = msg;
            
            // Check if we should process this message based on subscriptions
            if (this.shouldProcessMessage(address)) {
                this.handleOSCMessage(address, values);
            }
        });
        this.oscServer.on('error', (err) => {
            console.error(`[${this.appName}] OSC Server Error:`, err);
        });
    }
    shouldProcessMessage(address) {
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
    pathMatches(address, pattern) {
        // Handle exact match
        if (pattern === address) {
            return true;
        }
        // Handle wildcard patterns like /avatar/(!?vrcft)
        if (pattern.includes('(!?')) {
            const basePattern = pattern.split('(!?')[0];
            const excludePattern = pattern.split('(!?')[1].replace(')', '');
            
            if (address.startsWith(basePattern) && !address.includes(excludePattern)) {
                return true;
            }
        }
        // Handle simple prefix matching
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return address.startsWith(prefix);
        }
        return false;
    }
    handleOSCMessage(address, values) {
        console.log(`[${this.appName}] Received OSC: ${address} ->`, values);
        // Here you can add custom logic to handle specific VRChat parameters
        if (address.startsWith('/avatar/parameters/')) {
            this.handleAvatarParameter(address, values);
        } else if (address.startsWith('/chatbox/')) {
            this.handleChatbox(address, values);
        } else if (address.startsWith('/input/')) {
            this.handleInput(address, values);
        }
    }
    handleAvatarParameter(address, values) {
        const paramName = address.replace('/avatar/parameters/', '');
    }
    handleChatbox(address, values) {
        console.log(`[${this.appName}] Chatbox Message:`, values[0]);
    }
    handleInput(address, values) {
        console.log(`[${this.appName}] Input:`, address, values);
    }
    subscribe(path) {
        this.subscribeToAll = false;
        this.subscribedPaths.add(path);
        console.log(`[${this.appName}] Subscribed to path: ${path}`);
    }
    unsubscribe(path) {
        this.subscribedPaths.delete(path);
        console.log(`[${this.appName}] Unsubscribed from path: ${path}`);
        // If no subscriptions left, revert to subscribing to all
        if (this.subscribedPaths.size === 0) {
            this.subscribeToAll = true;
            console.log(`[${this.appName}] No more subscriptions, reverting to subscribe all`);
        }
    }
    subscribeToAll() {
        this.subscribeToAll = true;
        this.subscribedPaths.clear();
        console.log(`[${this.appName}] Now subscribing to all paths`);
    }
    setupOSCQueryEndpoints() {
        // Add some basic VRChat-compatible endpoints for discovery
        this.oscQueryServer.addMethod('/avatar/parameters', {
            description: 'VRChat Avatar Parameters',
            access: OSCQAccess.WRITEONLY,
        });
        this.oscQueryServer.addMethod('/chatbox/input', {
            description: 'VRChat Chatbox Input',
            access: OSCQAccess.WRITEONLY,
            arguments: [
                {
                    type: OSCTypeSimple.STRING,
                },
                {
                    type: OSCTypeSimple.TRUE,
                }
            ]
        });
        this.oscQueryServer.addMethod('/input', {
            description: 'VRChat Input Controls',
            access: OSCQAccess.WRITEONLY,
        });
    }
    async start() {
        try {
            console.log(`[${this.appName}] Starting VRChat OSC Query Server...`);
            // Setup OSC Query endpoints
            this.setupOSCQueryEndpoints();
            // Start OSC Query Server (for discovery)
            const hostInfo = await this.oscQueryServer.start();
            console.log(`[${this.appName}] OSC Query Server started:`, hostInfo);
            // Start OSC Server (for receiving data)
            this.setupOSCServer();
            console.log(`[${this.appName}] Server is ready and discoverable by VRChat!`);
            console.log(`[${this.appName}] OSC Query HTTP Server: http://localhost:${this.httpPort}`);
            console.log(`[${this.appName}] OSC UDP Server: localhost:${this.oscPort}`);
            console.log(`[${this.appName}] Subscribe to all paths: ${this.subscribeToAll}`);
        } catch (error) {
            console.error(`[${this.appName}] Failed to start server:`, error);
        }
    }
    async stop() {
        try {
            console.log(`[${this.appName}] Stopping servers...`);
            if (this.oscServer) {
                this.oscServer.close();
            }
            await this.oscQueryServer.stop();
            console.log(`[${this.appName}] Servers stopped.`);
        } catch (error) {
            console.error(`[${this.appName}] Error stopping servers:`, error);
        }
    }
}
// Create and start the server
const vrchatOSC = new VRChatOSCQuery("OSC-Query-JS-Demo-1");
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await vrchatOSC.stop();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await vrchatOSC.stop();
    process.exit(0);
});
vrchatOSC.start().catch(console.error);
module.exports = VRChatOSCQuery;
