/**
 * OSCQueryServer.js - HTTP server implementation for OSC Query protocol
 * 
 * This file implements the OSC Query HTTP server that provides REST API endpoints
 * for discovering OSC parameters and services. The server handles HTTP GET requests
 * and returns JSON responses describing the OSC parameter tree structure.
 * 
 * Key Features:
 * - HTTP server for OSC Query API endpoints
 * - mDNS service advertisement for automatic discovery
 * - JSON serialization of OSC parameter trees
 * - Support for OSC Query extensions and host info
 * - Automatic port finding to avoid conflicts
 * 
 * Usage in other projects:
 * const { OSCQueryServer } = require('./OSCQueryServer');
 * const server = new OSCQueryServer({ httpPort: 8080, oscPort: 9000 });
 * await server.start();
 */

// Required Node.js modules for HTTP and network functionality
const http = require('http');              // HTTP server implementation
const { Bonjour } = require('bonjour-service');  // mDNS service discovery/advertisement
const portfinder = require('portfinder');         // Automatic available port detection
const { OSCNode, OSCQAccess } = require('./OSCNode'); // OSC node tree structure

// ============================================================================
// OSC Query Protocol Constants
// ============================================================================

/**
 * OSC Query Extensions - Supported optional features
 * 
 * These flags indicate which optional OSC Query features this server supports.
 * Clients can check these to understand what functionality is available.
 */
const EXTENSIONS = {
    ACCESS: true,       // Supports read/write access control
    VALUE: true,        // Supports current value reporting
    RANGE: true,        // Supports value range constraints
    DESCRIPTION: true,  // Supports parameter descriptions
    TAGS: true,         // Supports metadata tags
    CRITICAL: true,     // Supports critical parameter flags
    CLIPMODE: true,     // Supports value clipping modes
};

/**
 * Valid OSC Query attributes for HTTP query parameters
 * 
 * These are the allowed query parameters that clients can use to request
 * specific parts of the OSC parameter information.
 * 
 * Examples:
 * - GET /avatar/parameters/VRCEmote?VALUE returns only the current value
 * - GET /?HOST_INFO returns server information
 */
const VALID_ATTRIBUTES = [
    "FULL_PATH",   // Complete OSC address path
    "CONTENTS",    // Child nodes (for containers)
    "TYPE",        // OSC argument types
    "ACCESS",      // Read/write permissions
    "RANGE",       // Value constraints
    "DESCRIPTION", // Human-readable description
    "TAGS",        // Metadata tags
    "CRITICAL",    // Critical parameter flag
    "CLIPMODE",    // Value clipping behavior
    "VALUE",       // Current parameter values
    "HOST_INFO",   // Server/host information
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Send JSON response to HTTP client
 * 
 * Helper function to properly format and send JSON responses with correct
 * content-type headers and formatting.
 * 
 * @param {Object} json - JavaScript object to serialize as JSON
 * @param {http.ServerResponse} res - HTTP response object
 */
function respondJson(json, res) {
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify(json));
    res.end();
}
// ============================================================================
// OSCQueryServer Class - Main server implementation
// ============================================================================

/**
 * OSCQueryServer - HTTP server implementing the OSC Query protocol
 * 
 * This class provides a complete OSC Query server implementation that:
 * 1. Serves HTTP requests for OSC parameter discovery
 * 2. Advertises the service via mDNS for automatic discovery
 * 3. Manages an OSC parameter tree structure
 * 4. Handles client queries for specific parameter information
 * 
 * The server creates REST-style endpoints where the URL path corresponds
 * to OSC addresses, and query parameters specify what information to return.
 * 
 * Example Usage:
 * const server = new OSCQueryServer({
 *   httpPort: 8080,
 *   oscPort: 9000,
 *   oscQueryHostName: "MyApp",
 *   serviceName: "MyApp OSC Query"
 * });
 * 
 * // Add an OSC parameter
 * server.addMethod('/avatar/parameters/VRCEmote', {
 *   description: 'VRChat emote trigger',
 *   access: OSCQAccess.WRITEONLY,
 *   arguments: [{ type: 'i' }]
 * });
 * 
 * await server.start();
 */
class OSCQueryServer {
    /**
     * Create a new OSC Query server
     * 
     * @param {Object} opts - Configuration options
     * @param {number} [opts.httpPort] - HTTP port (auto-detected if not specified)
     * @param {number} [opts.oscPort] - OSC UDP port for actual OSC communication
     * @param {string} [opts.bindAddress='0.0.0.0'] - Network interface to bind to
     * @param {string} [opts.oscQueryHostName] - Host name for OSC Query identification
     * @param {string} [opts.serviceName] - Service name for mDNS advertisement
     * @param {string} [opts.rootDescription] - Description for the root node
     * @param {string} [opts.oscIp] - IP address for OSC communication
     * @param {string} [opts.oscTransport='UDP'] - OSC transport protocol
     */
    constructor(opts = {}) {
        this._opts = opts;                                    // Store configuration options
        this._server = http.createServer(this._httpHandler.bind(this)); // Create HTTP server
        this._bonjour = new Bonjour();                       // mDNS service manager
        this._bonjourService = null;                         // Active mDNS service instance
        
        // Create root node of the OSC parameter tree
        this._root = new OSCNode("");
        this._root.setOpts({
            description: this._opts.rootDescription || "root node",
            access: OSCQAccess.NO_VALUE, // Root never has a value, only children
        });
    }

    /**
     * Main HTTP request handler
     * 
     * Routes all incoming HTTP requests. Currently only supports GET requests
     * as per the OSC Query specification.
     * 
     * @param {http.IncomingMessage} req - HTTP request object
     * @param {http.ServerResponse} res - HTTP response object
     * @private
     */
    _httpHandler(req, res) {
        // OSC Query only supports GET requests
        if (req.method != "GET") {
            res.statusCode = 400; // Bad Request
            res.end();
            return;
        }

        // Parse the requested URL
        const url = new URL(req.url, `http://${req.headers.host}`);
        return this._handleGet(url, res);
    }

    /**
     * Handle HTTP GET requests for OSC Query endpoints
     * 
     * Processes GET requests by:
     * 1. Parsing the URL path to find the requested OSC node
     * 2. Checking for query parameters (like ?VALUE or ?HOST_INFO)
     * 3. Returning appropriate JSON response
     * 
     * URL Structure:
     * - Path maps to OSC address: /avatar/parameters/VRCEmote
     * - Query parameter specifies what to return: ?VALUE, ?DESCRIPTION, etc.
     * - No query parameter returns complete node information
     * 
     * @param {URL} url - Parsed URL object
     * @param {http.ServerResponse} res - HTTP response object
     * @private
     */
    _handleGet(url, res) {
        // Extract query parameter (everything after ?)
        const query = (url.search.length > 0) ? url.search.substring(1) : null;
        
        // Split URL path into components, removing empty segments
        const path_split = url.pathname.split("/").filter(p => p !== "");

        // Validate query parameter if present
        if (query && !VALID_ATTRIBUTES.includes(query)) {
            res.statusCode = 400; // Bad Request
            return res.end();
        }

        // Handle special HOST_INFO query
        if (query == "HOST_INFO") {
            const hostInfo = {
                NAME: this._opts.oscQueryHostName,                    // Service name
                EXTENSIONS,                                           // Supported features
                OSC_IP: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0", // OSC IP
                OSC_PORT: this._opts.oscPort || this._opts.httpPort,             // OSC port
                OSC_TRANSPORT: this._opts.oscTransport || "UDP",      // OSC protocol
            };
            return respondJson(hostInfo, res);
        }

        // Navigate to the requested node in the tree
        let node = this._root;
        for (const path_component of path_split) {
            if (node.hasChild(path_component)) {
                node = node.getChild(path_component);
            } else {
                res.statusCode = 404; // Not Found
                return res.end();
            }
        }

        // Return the requested information
        if (!query) {
            // No query parameter - return complete node information
            return respondJson(node.serialize(), res);
        } else {
            // Specific query parameter - return only that attribute
            const serialized = node.serialize();
            const access = serialized.ACCESS;
            
            // Check access permissions for VALUE queries
            if (access !== undefined) {
                if ((access == 0 || access == 2) && query == "VALUE") {
                    // Parameter has no value or is write-only
                    res.statusCode = 204; // No Content
                    return res.end();
                }
            }
            
            // Return the requested attribute
            return respondJson({
                [query]: serialized[query],
            }, res);
        }
    }

    /**
     * Find a node in the tree by OSC path
     * 
     * Helper method to navigate the OSC parameter tree and find a specific node
     * based on its OSC address path.
     * 
     * @param {string} path - OSC path (e.g., "/avatar/parameters/VRCEmote")
     * @returns {OSCNode|null} The found node or null if not found
     * @private
     */
    _getNodeForPath(path) {
        const path_split = path.split("/").filter(p => p !== "");
        let node = this._root;
        
        for (const path_component of path_split) {
            if (node.hasChild(path_component)) {
                node = node.getChild(path_component);
            } else {
                return null; // Path not found
            }
        }
        
        return node;
    }
    // ========================================================================
    // Public API Methods - Server lifecycle and parameter management
    // ========================================================================

    /**
     * Start the OSC Query server and begin accepting connections
     * 
     * This method:
     * 1. Finds an available HTTP port (if not specified)
     * 2. Starts the HTTP server
     * 3. Advertises the service via mDNS for automatic discovery
     * 4. Returns server information for client use
     * 
     * @returns {Promise<Object>} Server information object
     */
    async start() {
        // Find an available port if none specified
        if (!this._opts.httpPort) {
            this._opts.httpPort = await portfinder.getPortAsync();
        }

        // Start HTTP server and wait for it to be ready
        const httpListenPromise = new Promise(resolve => {
            this._server.listen(this._opts.httpPort, this._opts.bindAddress || "0.0.0.0", resolve);
        });

        const serviceName = this._opts.serviceName || "OSCQuery";

        // Advertise service via mDNS so clients can discover us automatically
        // The 'oscjson' service type is the standard for OSC Query services
        this._bonjourService = this._bonjour.publish({
            name: serviceName,          // Human-readable service name
            type: 'oscjson',           // OSC Query service type
            port: this._opts.httpPort, // HTTP port where we're listening
            protocol: 'tcp'            // OSC Query uses TCP for HTTP
        });

        // Wait for HTTP server to start
        await httpListenPromise;

        // Return server information that clients can use
        return {
            name: this._opts.oscQueryHostName,
            extensions: EXTENSIONS,
            oscIp: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0",
            oscPort: this._opts.oscPort || this._opts.httpPort,
            oscTransport: this._opts.oscTransport || "UDP",
        };
    }

    /**
     * Stop the OSC Query server and clean up resources
     * 
     * Gracefully shuts down the HTTP server and stops mDNS advertisement.
     * Always call this before exiting your application to prevent resource leaks.
     * 
     * @returns {Promise} Resolves when server is fully stopped
     */
    async stop() {
        // Stop HTTP server and wait for it to close
        const httpEndPromise = new Promise((resolve, reject) => {
            this._server.close(err => err ? reject(err) : resolve());
        });

        // Stop mDNS service advertisement
        if (this._bonjourService) {
            this._bonjourService.stop();
        }

        // Clean up mDNS resources
        this._bonjour.destroy();

        // Wait for HTTP server to fully close
        await httpEndPromise;
    }

    /**
     * Add an OSC method/parameter to the server
     * 
     * Creates or updates an OSC parameter that clients can discover and interact with.
     * The path is split into components and a tree structure is built automatically.
     * 
     * @param {string} path - OSC address path (e.g., "/avatar/parameters/VRCEmote")
     * @param {Object} params - Parameter configuration
     * @param {string} [params.description] - Human-readable description
     * @param {number} [params.access] - Access permissions (OSCQAccess enum)
     * @param {Array} [params.tags] - Metadata tags
     * @param {boolean} [params.critical] - Whether this parameter is critical
     * @param {Array} [params.arguments] - OSC argument definitions
     * 
     * Example:
     * server.addMethod('/avatar/parameters/VRCEmote', {
     *   description: 'VRChat emote trigger parameter',
     *   access: OSCQAccess.WRITEONLY,
     *   arguments: [
     *     { type: OSCTypeSimple.INT, range: { min: 0, max: 8 } }
     *   ]
     * });
     */
    addMethod(path, params) {
        // Split path into components, removing empty segments
        const path_split = path.split("/").filter(p => p !== "");
        
        // Navigate/create the tree structure to the target node
        let node = this._root;
        for (const path_component of path_split) {
            node = node.getOrCreateChild(path_component);
        }
        
        // Configure the target node with the provided parameters
        node.setOpts(params);
    }

    /**
     * Remove an OSC method/parameter from the server
     * 
     * Removes an OSC parameter and cleans up any empty container nodes
     * that are left behind. This helps keep the tree structure clean.
     * 
     * @param {string} path - OSC address path to remove
     */
    removeMethod(path) {
        let node = this._getNodeForPath(path);
        if (!node) return; // Path doesn't exist

        // Clear the node's parameters, making it an empty container
        node.setOpts({});

        // Clean up empty nodes by traversing back up the tree
        // Remove empty containers until we reach root or find a non-empty node
        while (node.parent != null && node.isEmpty()) {
            node.parent.removeChild(node.name);
            node = node.parent;
        }
    }

    /**
     * Set the current value of an OSC parameter argument
     * 
     * Updates the stored value for a specific argument of an OSC parameter.
     * The value will be returned to clients when they query the parameter
     * (if the parameter has read access).
     * 
     * @param {string} path - OSC address path
     * @param {number} arg_index - Index of the argument to set (0-based)
     * @param {*} value - The value to set
     */
    setValue(path, arg_index, value) {
        const node = this._getNodeForPath(path);

        if (node) {
            node.setValue(arg_index, value);
        }
    }

    /**
     * Clear the current value of an OSC parameter argument
     * 
     * Removes the stored value for a specific argument. The argument will
     * appear as null in OSC Query responses until a new value is set.
     * 
     * @param {string} path - OSC address path
     * @param {number} arg_index - Index of the argument to clear (0-based)
     */
    unsetValue(path, arg_index) {
        const node = this._getNodeForPath(path);

        if (node) {
            node.unsetValue(arg_index);
        }
    }
}

// ============================================================================
// Module Exports - Make classes and constants available to other modules
// ============================================================================

module.exports = {
    OSCQueryServer,                        // Main server class
    OSCQAccess,                           // Access control constants
    OSCTypeSimple: require('./OSCNode').OSCTypeSimple  // OSC type constants
};