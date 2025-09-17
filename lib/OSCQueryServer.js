const http = require('http');
const { Bonjour } = require('bonjour-service');
const portfinder = require('portfinder');
const { OSCNode, OSCQAccess } = require('./OSCNode');
const EXTENSIONS = {
    ACCESS: true,
    VALUE: true,
    RANGE: true,
    DESCRIPTION: true,
    TAGS: true,
    CRITICAL: true,
    CLIPMODE: true,
};
const VALID_ATTRIBUTES = [
    "FULL_PATH",
    "CONTENTS",
    "TYPE",
    "ACCESS",
    "RANGE",
    "DESCRIPTION",
    "TAGS",
    "CRITICAL",
    "CLIPMODE",
    "VALUE",
    "HOST_INFO",
];
function respondJson(json, res) {
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify(json));
    res.end();
}
class OSCQueryServer {
    constructor(opts = {}) {
        this._opts = opts;
        this._server = http.createServer(this._httpHandler.bind(this));
        this._bonjour = new Bonjour();
        this._bonjourService = null;
        this._root = new OSCNode("");
        this._root.setOpts({
            description: this._opts.rootDescription || "root node",
            access: OSCQAccess.NO_VALUE,
        });
    }
    _httpHandler(req, res) {
        if (req.method != "GET") {
            res.statusCode = 400;
            res.end();
            return;
        }
        const url = new URL(req.url, `http://${req.headers.host}`);
        return this._handleGet(url, res);
    }
    _handleGet(url, res) {
        const query = (url.search.length > 0) ? url.search.substring(1) : null;
        const path_split = url.pathname.split("/").filter(p => p !== "");
        if (query && !VALID_ATTRIBUTES.includes(query)) {
            res.statusCode = 400;
            return res.end();
        }
        if (query == "HOST_INFO") {
            const hostInfo = {
                NAME: this._opts.oscQueryHostName,
                EXTENSIONS,
                OSC_IP: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0",
                OSC_PORT: this._opts.oscPort || this._opts.httpPort,
                OSC_TRANSPORT: this._opts.oscTransport || "UDP",
            };
            return respondJson(hostInfo, res);
        }
        let node = this._root;
        for (const path_component of path_split) {
            if (node.hasChild(path_component)) {
                node = node.getChild(path_component);
            } else {
                res.statusCode = 404;
                return res.end();
            }
        }
        if (!query) {
            return respondJson(node.serialize(), res);
        } else {
            const serialized = node.serialize();
            const access = serialized.ACCESS;
            if (access !== undefined) {
                if ((access == 0 || access == 2) && query == "VALUE") {
                    res.statusCode = 204;
                    return res.end();
                }
            }
            return respondJson({
                [query]: serialized[query],
            }, res);
        }
    }
    _getNodeForPath(path) {
        const path_split = path.split("/").filter(p => p !== "");
        let node = this._root;
        for (const path_component of path_split) {
            if (node.hasChild(path_component)) {
                node = node.getChild(path_component);
            } else {
                return null;
            }
        }
        return node;
    }
    async start() {
        if (!this._opts.httpPort) {
            this._opts.httpPort = await portfinder.getPortAsync();
        }
        const httpListenPromise = new Promise(resolve => {
            this._server.listen(this._opts.httpPort, this._opts.bindAddress || "0.0.0.0", resolve);
        });
        const serviceName = this._opts.serviceName || "OSCQuery";
        // Create Bonjour service for mDNS advertisement
        this._bonjourService = this._bonjour.publish({
            name: serviceName,
            type: 'oscjson',
            port: this._opts.httpPort,
            protocol: 'tcp'
        });
        await httpListenPromise;
        return {
            name: this._opts.oscQueryHostName,
            extensions: EXTENSIONS,
            oscIp: this._opts.oscIp || this._opts.bindAddress || "0.0.0.0",
            oscPort: this._opts.oscPort || this._opts.httpPort,
            oscTransport: this._opts.oscTransport || "UDP",
        };
    }
    async stop() {
        const httpEndPromise = new Promise((resolve, reject) => {
            this._server.close(err => err ? reject(err) : resolve());
        });
        if (this._bonjourService) {
            this._bonjourService.stop();
        }
        this._bonjour.destroy();
        await httpEndPromise;
    }
    addMethod(path, params) {
        const path_split = path.split("/").filter(p => p !== "");
        let node = this._root;
        for (const path_component of path_split) {
            node = node.getOrCreateChild(path_component);
        }
        node.setOpts(params);
    }
    removeMethod(path) {
        let node = this._getNodeForPath(path);
        if (!node) return;
        node.setOpts({}); // make the node into an empty container
        // go back through the nodes in reverse and delete nodes until we have either reached the root or
        // hit a non-empty one
        while (node.parent != null && node.isEmpty()) {
            node.parent.removeChild(node.name);
            node = node.parent;
        }
    }
    setValue(path, arg_index, value) {
        const node = this._getNodeForPath(path);

        if (node) {
            node.setValue(arg_index, value);
        }
    }
    unsetValue(path, arg_index) {
        const node = this._getNodeForPath(path);

        if (node) {
            node.unsetValue(arg_index);
        }
    }
}
module.exports = {
    OSCQueryServer,
    OSCQAccess,
    OSCTypeSimple: require('./OSCNode').OSCTypeSimple
};