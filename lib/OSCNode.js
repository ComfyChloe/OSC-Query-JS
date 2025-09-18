/**
 * OSCNode.js - Core classes for building OSC Query tree structures
 * 
 * This file contains the fundamental building blocks for creating OSC Query servers.
 * OSC Query is a protocol that allows applications to discover and interact with
 * OSC (Open Sound Control) enabled services over HTTP and UDP.
 * 
 * Key Components:
 * - OSCTypeSimple: Standard OSC data types
 * - OSCQAccess: Access control flags (read/write permissions)
 * - OSCNode: Tree node class representing OSC parameters and containers
 * 
 * Usage in other projects:
 * const { OSCNode, OSCTypeSimple, OSCQAccess } = require('./OSCNode');
 */

// ============================================================================
// OSC Type Definitions - Standard data types supported by OSC
// ============================================================================

/**
 * OSC Type enumeration defining standard OSC data types
 * 
 * These single-character codes identify the data type of OSC arguments.
 * Used in OSC type tag strings and OSC Query type specifications.
 * 
 * Standard types are universally supported, non-standard may not work everywhere.
 */
const OSCTypeSimple = {
    // Standard OSC types (universally supported):
    INT: "i",        // 32-bit signed integer
    FLOAT: "f",      // 32-bit IEEE 754 floating point
    STRING: "s",     // UTF-8 string with null terminator
    BLOB: "b",       // Binary large object (byte array)
    
    // Non-standard OSC types (may not be supported by all implementations):
    BIGINT: "h",     // 64-bit signed integer
    TIMETAG: "t",    // 64-bit NTP timestamp
    DOUBLE: "d",     // 64-bit IEEE 754 floating point  
    ALTSTRING: "S",  // Alternative string encoding
    CHAR: "c",       // Single ASCII character
    COLOR: "r",      // RGBA color value
    MIDI: "m",       // MIDI message bytes
    TRUE: "T",       // Boolean true (no argument data)
    FALSE: "F",      // Boolean false (no argument data) 
    NIL: "N",        // Null/undefined value
    INFINITUM: "I",  // Infinite value
};
// ============================================================================
// OSC Access Control Definitions - Permission flags for OSC parameters
// ============================================================================

/**
 * OSC Query Access Control enumeration
 * 
 * These flags define read/write permissions for OSC parameters.
 * Used to indicate whether a parameter can be read from, written to, or both.
 * 
 * Access control helps clients understand how they can interact with parameters.
 */
const OSCQAccess = {
    NO_VALUE: 0,    // Parameter has no value (container node only)
    READONLY: 1,    // Parameter can only be read (client receives values)
    WRITEONLY: 2,   // Parameter can only be written (client sends values)
    READWRITE: 3,   // Parameter supports both read and write operations
    
    // Alternative naming for convenience:
    NA: 0,          // Same as NO_VALUE
    R: 1,           // Same as READONLY  
    W: 2,           // Same as WRITEONLY
    RW: 3,          // Same as READWRITE
};

// ============================================================================
// Utility Functions - Helper functions for type and range handling
// ============================================================================

/**
 * Convert OSC type to string representation
 * 
 * Handles both single types and array types for complex OSC arguments.
 * Array types are represented with square brackets containing type characters.
 * 
 * @param {string|Array} type - OSC type or array of types
 * @returns {string} String representation of the type
 * 
 * Examples:
 * - getTypeString("f") returns "f"
 * - getTypeString(["f", "i"]) returns "[fi]"
 */
function getTypeString(type) {
    if (Array.isArray(type)) {
        return "[" + type.map(getTypeString).join("") + "]";
    } else {
        return type;
    }
}

/**
 * Serialize range constraints for OSC parameters
 * 
 * Converts internal range objects to OSC Query format.
 * Handles both single ranges and arrays of ranges for complex arguments.
 * 
 * @param {Object|Array} range - Range constraint object or array
 * @returns {Object|Array|null} Serialized range data
 */
function serializeRange(range) {
    if (Array.isArray(range)) {
        return range.map(r => serializeRange(r));
    } else {
        if (range !== null) {
            return {
                MAX: range.max,    // Maximum allowed value
                MIN: range.min,    // Minimum allowed value  
                VALS: range.vals,  // Array of allowed discrete values
            };
        } else {
            return null;
        }
    }
}

/**
 * Build the full OSC path for a node by traversing up the tree
 * 
 * Recursively constructs the complete OSC address path from root to node.
 * Used for generating full paths in OSC Query responses.
 * 
 * @param {OSCNode} node - The node to build the path for
 * @returns {string} Complete OSC path (e.g., "/avatar/parameters/VRCEmote")
 */
function assembleFullPath(node) {
    if (node.parent == null) {
        return ""; // Root node has no path prefix
    } else {
        return assembleFullPath(node.parent) + "/" + node.name;
    }
}

/**
 * Check if all elements in an array are null
 * 
 * Utility function used to determine if optional fields should be omitted
 * from serialized output to keep JSON responses clean.
 * 
 * @param {Array} arr - Array to check
 * @returns {boolean} True if all elements are null
 */
function allNull(arr) {
    for (const elem of arr) {
        if (elem !== null) return false;
    }
    return true;
}
// ============================================================================
// OSCNode Class - Core building block for OSC Query tree structures  
// ============================================================================

/**
 * OSCNode - Represents a node in the OSC Query tree structure
 * 
 * Each node can be either:
 * 1. A container node - Has child nodes but no OSC arguments (like a folder)
 * 2. A parameter node - Has OSC arguments but no children (like a parameter)
 * 3. An empty node - Has neither children nor arguments (placeholder)
 * 
 * Nodes form a tree structure that mirrors the OSC address space.
 * The tree structure allows clients to discover available OSC parameters
 * and understand the organization of the OSC namespace.
 * 
 * Example tree structure:
 * /
 * ├── avatar/
 * │   ├── parameters/
 * │   │   ├── VRCEmote (parameter)
 * │   │   └── VRCFaceBlendH (parameter)
 * │   └── change (parameter)
 * └── chatbox/
 *     ├── input (parameter)
 *     └── typing (parameter)
 */
class OSCNode {
    /**
     * Create a new OSC node
     * 
     * @param {string} name - The name of this node (last part of OSC path)
     * @param {OSCNode|null} parent - Parent node in the tree (null for root)
     */
    constructor(name, parent) {
        this._name = name;                  // Node name (e.g., "VRCEmote")
        this._parent = parent;              // Parent node reference
        
        // OSC Query parameter properties (undefined = not set):
        this._description = undefined;      // Human-readable description
        this._access = undefined;           // Read/write permissions  
        this._tags = undefined;             // Metadata tags array
        this._critical = undefined;         // Boolean - is this parameter critical?
        this._args = undefined;             // Array of OSC argument definitions
        
        this._children = {};                // Child nodes keyed by name
    }

    /**
     * Get the parent node of this node
     * @returns {OSCNode|null} Parent node or null if this is root
     */
    get parent() {
        return this._parent || null;
    }

    /**
     * Get the name of this node
     * @returns {string} Node name
     */
    get name() {
        return this._name;
    }

    /**
     * Generate method description for OSC Query responses
     * 
     * Creates a description object for this node when it represents
     * an OSC method (has arguments). Used internally for method discovery.
     * 
     * @param {string} full_path - Complete OSC path to this node
     * @returns {Object} Method description object
     * @private
     */
    _getMethodDescription(full_path) {
        const desc = {
            full_path, // Always include the full OSC path
        };
        
        // Include optional properties only if they are defined:
        if (this._description) desc.description = this._description;
        if (this._access !== undefined) desc.access = this._access;
        if (this._tags) desc.tags = this._tags;
        if (this._critical !== undefined) desc.critical = this._critical;
        if (this._args) desc.arguments = this._args;

        return desc;
    }

    /**
     * Generator function that yields method descriptions for all OSC methods in this subtree
     * 
     * Recursively traverses the tree and yields method descriptions for all nodes
     * that have OSC arguments (are actual methods, not just containers).
     * 
     * @param {string} starting_path - Path prefix for this subtree
     * @yields {Object} Method description objects
     * @private
     */
    *_methodGenerator(starting_path = "/") {
        // If this node has arguments, it's a method - yield its description
        if (!this.isContainer()) {
            yield this._getMethodDescription(starting_path);
        }

        // Add separator for child paths (unless we're at root)
        if (starting_path !== "/") {
            starting_path += "/";
        }

        // Recursively generate methods from all child nodes
        if (this._children) {
            for (const child of Object.values(this._children)) {
                for (const md of child._methodGenerator(starting_path + child.name)) {
                    yield md;
                }
            }
        }
    }

    /**
     * Set OSC Query properties for this node
     * 
     * Configures this node as an OSC parameter with the specified properties.
     * This transforms the node from a container into an actual OSC parameter.
     * 
     * @param {Object} desc - Parameter description object
     * @param {string} [desc.description] - Human-readable description
     * @param {number} [desc.access] - Access permissions (OSCQAccess enum)
     * @param {Array} [desc.tags] - Metadata tags
     * @param {boolean} [desc.critical] - Whether this parameter is critical
     * @param {Array} [desc.arguments] - OSC argument definitions
     */
    setOpts(desc) {
        this._description = desc.description;
        this._access = desc.access;
        this._tags = desc.tags;
        this._critical = desc.critical;
        this._args = desc.arguments;
    }

    /**
     * Set the current value of a specific argument
     * 
     * Updates the stored value for an OSC argument. This value will be
     * returned in OSC Query responses if the parameter has read access.
     * 
     * @param {number} arg_index - Index of the argument to set (0-based)
     * @param {*} value - The value to set
     * @throws {Error} If argument index is out of range
     */
    setValue(arg_index, value) {
        if (!this._args || arg_index >= this._args.length) {
            throw new Error("Argument index out of range");
        }
        this._args[arg_index].value = value;
    }

    /**
     * Remove the stored value for a specific argument
     * 
     * @param {number} arg_index - Index of the argument to unset (0-based)
     * @throws {Error} If argument index is out of range
     */
    unsetValue(arg_index) {
        if (!this._args || arg_index >= this._args.length) {
            throw new Error("Argument index out of range");
        }
        delete this._args[arg_index].value;
    }

    /**
     * Get the current value of a specific argument
     * 
     * @param {number} arg_index - Index of the argument to get (0-based)
     * @returns {*|null} The argument value or null if not set/invalid index
     */
    getValue(arg_index) {
        if (!this._args || arg_index >= this._args.length) {
            return null;
        }
        return this._args[arg_index].value;
    }

    /**
     * Check if this node is completely empty
     * 
     * An empty node has no arguments and no children.
     * Empty nodes are typically removed during tree cleanup.
     * 
     * @returns {boolean} True if the node is empty
     */
    isEmpty() {
        return !this._args && Object.keys(this._children).length == 0;
    }

    /**
     * Check if this node is a container (has children but no arguments)
     * 
     * Container nodes organize the OSC namespace but don't represent
     * actual OSC parameters themselves.
     * 
     * @returns {boolean} True if the node is a container
     */
    isContainer() {
        return !this._args && Object.keys(this._children).length > 0;
    }

    // ========================================================================
    // Child Node Management Methods
    // ========================================================================

    /**
     * Add a child node to this container
     * 
     * @param {string} path - Name of the child node
     * @param {OSCNode} node - The child node to add
     * @throws {Error} If a child with this name already exists
     */
    addChild(path, node) {
        if (path in this._children) {
            throw new Error(`The child ${path} already exist`);
        }
        this._children[path] = node;
    }

    /**
     * Check if a child node exists
     * 
     * @param {string} path - Name of the child to check
     * @returns {boolean} True if the child exists
     */
    hasChild(path) {
        return path in this._children;
    }

    /**
     * Get a specific child node
     * 
     * @param {string} path - Name of the child to get
     * @returns {OSCNode} The child node
     */
    getChild(path) {
        return this._children[path];
    }

    /**
     * Get all child nodes as an array
     * 
     * @returns {Array<OSCNode>} Array of all child nodes
     */
    getChildren() {
        return Object.values(this._children);
    }

    /**
     * Remove a child node
     * 
     * @param {string} path - Name of the child to remove
     */
    removeChild(path) {
        if (this.hasChild(path)) {
            delete this._children[path];
        }
    }

    /**
     * Get an existing child or create a new one
     * 
     * This is useful for building tree structures where you want to
     * ensure a path exists without checking if it already exists.
     * 
     * @param {string} path - Name of the child node
     * @returns {OSCNode} Existing or newly created child node
     */
    getOrCreateChild(path) {
        if (!this.hasChild(path)) {
            this._children[path] = new OSCNode(path, this);
        }
        return this._children[path];
    }
    /**
     * Serialize this node to OSC Query JSON format
     * 
     * Converts the node and its properties to the standard OSC Query JSON format
     * used in HTTP responses. This format is defined by the OSC Query specification
     * and is what clients expect to receive when discovering OSC parameters.
     * 
     * The serialized format includes:
     * - FULL_PATH: Complete OSC address for this node
     * - DESCRIPTION: Human-readable description (if set)
     * - ACCESS: Read/write permissions (if set)
     * - TAGS: Metadata tags array (if set)
     * - CRITICAL: Critical flag (if set)
     * - CONTENTS: Child nodes (if any)
     * - TYPE: OSC type string for arguments (if has arguments)
     * - RANGE: Value constraints (if set)
     * - CLIPMODE: Clipping behavior (if set)
     * - VALUE: Current values (if readable and has values)
     * 
     * @returns {Object} OSC Query JSON representation of this node
     */
    serialize() {
        const full_path = assembleFullPath(this);
        const result = {
            FULL_PATH: full_path || "/", // Root path is represented as "/"
        };

        // Add description if specified
        if (this._description) result.DESCRIPTION = this._description;
        
        // Set access permissions
        if (this._access !== undefined) {
            result.ACCESS = this._access;
        } else if (this.isContainer()) {
            // Container nodes have no value by default
            result.ACCESS = OSCQAccess.NO_VALUE;
        }

        // Add optional metadata
        if (this._tags) result.TAGS = this._tags;
        if (this._critical !== undefined) result.CRITICAL = this._critical;

        // Serialize child nodes (for containers)
        if (Object.keys(this._children).length > 0) {
            result.CONTENTS = Object.fromEntries(Object.entries(this._children).map(([name, node]) => {
                return [name, node.serialize()]
            }));
        }

        // Serialize OSC arguments (for parameters)
        if (this._args) {
            let arg_types = "";        // Type string (e.g., "fis" for float, int, string)
            let arg_ranges = [];       // Range constraints for each argument
            let arg_clipmodes = [];    // Clipping modes for each argument
            const arg_values = [];     // Current values for each argument

            // Process each argument
            for (const arg of this._args) {
                arg_types += getTypeString(arg.type);           // Build type string
                arg_values.push(arg.value ?? null);            // Collect values (null if unset)
                arg_ranges.push(arg.range ?? null);            // Collect range constraints
                arg_clipmodes.push(arg.clipmode ?? null);      // Collect clip modes
            }

            result.TYPE = arg_types;

            // Include range constraints only if at least one argument has a range
            if (!allNull(arg_ranges)) {
                result.RANGE = arg_ranges.map(range => {
                    if (range) {
                        return serializeRange(range);
                    } else {
                        return null;
                    }
                });
            }

            // Include clip modes only if at least one argument has a clip mode
            if (!allNull(arg_clipmodes)) {
                result.CLIPMODE = arg_clipmodes;
            }

            // Include current values only if:
            // 1. Access is defined AND
            // 2. At least one value is set AND  
            // 3. The parameter is readable (access = 1 or 3)
            if (this._access !== undefined && !allNull(arg_values) && (this._access == 1 || this._access == 3)) {
                result.VALUE = arg_values;
            }
        }

        return result;
    }
}

// ============================================================================
// Module Exports - Make classes and constants available to other modules
// ============================================================================

module.exports = {
    OSCNode,        // Main node class for building OSC Query trees
    OSCTypeSimple,  // OSC type constants  
    OSCQAccess      // Access control constants
};