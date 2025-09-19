# OSC Query JS

A pure JavaScript implementation of the OSC Query protocol for VRChat and other OSC-compatible applications. This library provides both server and client functionality for discovering and interacting with OSC services over HTTP and UDP.

## 🚀 What is OSC Query?

OSC Query is a protocol that extends OSC (Open Sound Control) by adding HTTP-based service discovery and parameter exploration. It allows applications to:

- **Automatically discover** OSC services on the network via mDNS
- **Explore available parameters** through a REST API
- **Understand parameter types** and constraints before sending data
- **Get real-time values** from readable parameters

This is particularly useful for VRChat integration, where applications can discover and interact with VRChat's OSC parameters without manual configuration.

## 📦 Installation

### Option 1: Clone and Run
```bash
git clone https://github.com/ComfyChloe/OSC-Query-JS.git
cd OSC-Query-JS
npm install
npm start
```

### Option 2: Use in Your Project
```bash
npm install node-osc bonjour-service portfinder
```

Copy the `lib/` folder and `Main.js` to your project, then:

```javascript
const VRChatOSCQuery = require('./Main.js');
const oscServer = new VRChatOSCQuery("MyApp");
oscServer.start();
```

## 🎯 Basic Usage Examples

### Simple VRChat Integration

```javascript
const VRChatOSCQuery = require('./Main.js');

// Create server with custom name
const vrchat = new VRChatOSCQuery("MyVRChatApp");

// Override message handlers for custom logic
vrchat.handleAvatarParameter = function(address, values) {
    const paramName = address.replace('/avatar/parameters/', '');
    console.log(`Avatar parameter changed: ${paramName} = ${values[0]}`);
    
    // Example: React to specific parameters
    if (paramName === 'VRCEmote') {
        console.log(`Emote triggered: ${values[0]}`);
        // Your custom logic here
    }
};

vrchat.handleChatbox = function(address, values) {
    const [message, isTyping] = values;
    console.log(`Chat: "${message}" (typing: ${isTyping})`);
    
    // Example: Respond to chat commands
    if (message.startsWith('!help')) {
        // Send response back to VRChat (requires separate OSC client)
    }
};

// Start the server
vrchat.start();
```

### Advanced Parameter Filtering

```javascript
const vrchat = new VRChatOSCQuery("FilteredApp");

// Subscribe to specific parameter patterns only
vrchat.subscribe('/avatar/parameters/VRC*'); // Only VRChat built-in parameters
vrchat.subscribe('/avatar/parameters/MyCustomParam'); // Specific custom parameter
vrchat.subscribe('/avatar/parameters/(!?vrcft)'); // Exclude VRCFT parameters

// Or subscribe to all avatar parameters but exclude inputs
vrchat.subscribeToAllPaths();
vrchat.unsubscribe('/input/*');

vrchat.start();
```

## 🔧 Building Your Own OSC Query Application

### Using the Core Components

```javascript
const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('./lib/OSCQueryServer');

// Create a custom OSC Query server
const server = new OSCQueryServer({
    httpPort: 8080,
    oscPort: 9000,
    oscQueryHostName: "MyCustomApp",
    serviceName: "My OSC Service",
    rootDescription: "Custom OSC Query Service"
});

// Add custom parameters that other apps can discover
server.addMethod('/myapp/volume', {
    description: 'Application volume control',
    access: OSCQAccess.READWRITE, // Can read and write
    arguments: [
        {
            type: OSCTypeSimple.FLOAT,
            range: { min: 0.0, max: 1.0 } // Volume range 0-100%
        }
    ]
});

server.addMethod('/myapp/status', {
    description: 'Application status message',
    access: OSCQAccess.READONLY, // Read-only
    arguments: [
        { type: OSCTypeSimple.STRING }
    ]
});

// Start the server
server.start().then(hostInfo => {
    console.log('OSC Query server started:', hostInfo);
    
    // Set initial values
    server.setValue('/myapp/volume', 0, 0.5); // 50% volume
    server.setValue('/myapp/status', 0, 'Running');
});
```

### Creating OSC Parameter Trees

```javascript
// Complex parameter organization
server.addMethod('/audio/output/volume', {
    description: 'Output volume control',
    access: OSCQAccess.READWRITE,
    arguments: [{ type: OSCTypeSimple.FLOAT, range: { min: 0, max: 1 } }]
});

server.addMethod('/audio/output/mute', {
    description: 'Output mute toggle',
    access: OSCQAccess.READWRITE,
    arguments: [{ type: OSCTypeSimple.TRUE }] // Boolean parameter
});

server.addMethod('/audio/input/gain', {
    description: 'Input gain control',
    access: OSCQAccess.READWRITE,
    arguments: [{ type: OSCTypeSimple.FLOAT, range: { min: 0, max: 2 } }]
});

// This creates a tree structure:
// /audio/
//   ├── output/
//   │   ├── volume
//   │   └── mute
//   └── input/
//       └── gain
```

## 🌐 Network Discovery and Client Usage

### Finding OSC Query Services

```javascript
const { Bonjour } = require('bonjour-service');
const bonjour = new Bonjour();

// Discover all OSC Query services on the network
bonjour.find({ type: 'oscjson' }, (service) => {
    console.log('Found OSC Query service:', {
        name: service.name,
        host: service.host,
        port: service.port,
        url: `http://${service.host}:${service.port}`
    });
    
    // You can now make HTTP requests to explore parameters
    fetch(`http://${service.host}:${service.port}/?HOST_INFO`)
        .then(res => res.json())
        .then(info => console.log('Service info:', info));
});
```

### Exploring Parameters via HTTP

```bash
# Get service information
curl http://localhost:8080/?HOST_INFO

# Get all available parameters
curl http://localhost:8080/

# Get specific parameter info
curl http://localhost:8080/avatar/parameters/VRCEmote

# Get only the current value
curl http://localhost:8080/avatar/parameters/VRCEmote?VALUE

# Get only the parameter type
curl http://localhost:8080/avatar/parameters/VRCEmote?TYPE
```

## 📚 API Reference

### VRChatOSCQuery Class

#### Constructor
```javascript
new VRChatOSCQuery(appName)
```

#### Methods
- `start()` - Start the OSC Query server
- `stop()` - Stop the server and clean up
- `subscribe(path)` - Subscribe to specific OSC path patterns
- `unsubscribe(path)` - Unsubscribe from path patterns
- `subscribeToAllPaths()` - Enable subscription to all paths

#### Override-able Handlers
- `handleOSCMessage(address, values)` - Process any OSC message
- `handleAvatarParameter(address, values)` - Handle avatar parameter changes
- `handleChatbox(address, values)` - Handle chatbox messages
- `handleInput(address, values)` - Handle input state changes

### OSCQueryServer Class

#### Constructor Options
- `httpPort` - HTTP server port (auto-detected if not set)
- `oscPort` - OSC UDP port
- `oscQueryHostName` - Service hostname
- `serviceName` - mDNS service name
- `rootDescription` - Root node description

#### Methods
- `addMethod(path, params)` - Add OSC parameter
- `removeMethod(path)` - Remove OSC parameter
- `setValue(path, argIndex, value)` - Set parameter value
- `unsetValue(path, argIndex)` - Clear parameter value

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- VRChat team for OSC implementation and documentation
- OSC Query specification contributors
- Node.js OSC community libraries
