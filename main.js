const net = require('net');
const http = require('http');
const { WebSocket, createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');

// ========== Logging (set LOG_LEVEL=0 in production to disable verbose logs) ==========
const LOG_LEVEL = parseInt(process.env.LOG_LEVEL || '1', 10);
const log = LOG_LEVEL >= 1
    ? (...args) => console.log(new Date().toISOString(), ...args)
    : () => {};
const logError = (...args) => console.error(new Date().toISOString(), ...args);

// ========== Configuration ==========
const uuid = (process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4').replace(/-/g, '');
const port = process.env.PORT || 8080;

// ========== Pre-parse UUID bytes once (avoid re-parsing per connection) ==========
const UUID_BYTES = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
    UUID_BYTES[i] = parseInt(uuid.substr(i * 2, 2), 16);
}

// ========== Timing Constants ==========
const TCP_CONNECT_TIMEOUT = 10000;
const TCP_KEEPALIVE_DELAY = 30000;
const WS_PING_INTERVAL = 25000;

// ========== Reusable TextDecoder instance ==========
const textDecoder = new TextDecoder();

// ========== Cache the HTML page in memory ==========
const HOME_HTML = buildHomePage(uuid);
const HOME_HTML_BUFFER = Buffer.from(HOME_HTML, 'utf8');
const HOME_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': HOME_HTML_BUFFER.byteLength,
    'Cache-Control': 'public, max-age=3600',
};

function buildHomePage(displayUuid) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VLESS Proxy Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {
            font-family: 'Inter', sans-serif;
        }
        .modal-backdrop {
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 999;
        }
        .modal-content {
            z-index: 1000;
        }
    </style>
</head>
<body class="bg-gradient-to-br from-blue-500 to-purple-600 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full text-center">
        <h1 class="text-4xl font-bold text-gray-800 mb-4">VLESS Proxy</h1>
        <p class="text-lg text-gray-600 mb-6">
            Your secure and efficient proxy server is running.
        </p>
        <div class="bg-gray-100 p-6 rounded-md mb-6">
            <h2 class="text-xl font-semibold text-gray-700 mb-3">Server Status: Online</h2>
            <div class="text-left text-gray-700">
                <p class="text-sm text-gray-500 mt-4">
                    Click the button below to get your VLESS configuration details.
                </p>
            </div>
        </div>
        <button id="getConfigBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75">
            Get My VLESS Config
        </button>
        <p class="text-md text-gray-700 mt-6">
            Join my Telegram channel for more updates: <a href="https://t.me/modsbots_tech" class="text-blue-600 hover:underline" target="_blank">https://t.me/modsbots_tech</a>
        </p>
    </div>

    <div id="vlessConfigModal" class="fixed inset-0 hidden items-center justify-center modal-backdrop">
        <div class="bg-white p-8 rounded-lg shadow-xl max-w-xl w-full modal-content relative">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">Your VLESS Configuration</h2>
            <div class="bg-gray-100 p-4 rounded-md mb-4 text-left">
                <p class="mb-2"><strong>UUID:</strong> <span id="modalUuid" class="break-all font-mono text-sm"></span></p>
                <p class="mb-2"><strong>Port:</strong> <span id="modalPort" class="font-mono text-sm"></span></p>
                <p class="mb-2"><strong>Host:</strong> <span id="modalHost" class="font-mono text-sm"></span></p>
                <textarea id="vlessUri" class="w-full h-32 p-2 mt-4 border rounded-md resize-none bg-gray-50 text-gray-700 font-mono text-sm" readonly></textarea>
            </div>
            <button id="copyConfigBtn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75 mr-2">
                Copy URI
            </button>
            <button id="closeModalBtn" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75">
                Close
            </button>
            <div id="copyMessage" class="text-sm text-green-600 mt-2 hidden">Copied to clipboard!</div>
            <div id="checkStatus" class="text-sm mt-2"></div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const getConfigBtn = document.getElementById('getConfigBtn');
            const vlessConfigModal = document.getElementById('vlessConfigModal');
            const closeModalBtn = document.getElementById('closeModalBtn');
            const copyConfigBtn = document.getElementById('copyConfigBtn');
            const modalUuid = document.getElementById('modalUuid');
            const modalPort = document.getElementById('modalPort');
            const modalHost = document.getElementById('modalHost');
            const vlessUri = document.getElementById('vlessUri');
            const copyMessage = document.getElementById('copyMessage');
            const checkStatus = document.getElementById('checkStatus');

            const serverUuid = "${displayUuid}";
            const serverPort = "443";
            const serverHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;

            getConfigBtn.addEventListener('click', async () => {
                modalUuid.textContent = serverUuid;
                modalPort.textContent = serverPort;
                modalHost.textContent = serverHost;

                const uri = \`vless://\${serverUuid}@\${serverHost}:443?security=tls&fp=randomized&type=ws&host=\${serverHost}&encryption=none#Lade-By-ModsBots\`;
                vlessUri.value = uri;

                vlessConfigModal.classList.remove('hidden');
                vlessConfigModal.classList.add('flex');
                copyMessage.classList.add('hidden');
                checkStatus.textContent = '';

                const externalCheckUrl = \`https://deno-proxy-version.deno.dev/?check=\${encodeURIComponent(uri)}\`;
                checkStatus.className = 'text-sm mt-2 text-gray-700';
                checkStatus.textContent = 'Checking VLESS config with external service...';

                try {
                    const response = await fetch(externalCheckUrl);
                    if (response.ok) {
                        const data = await response.text();
                        checkStatus.textContent = \`External check successful! Response: \${data.substring(0, 100)}...\`;
                        checkStatus.classList.remove('text-gray-700');
                        checkStatus.classList.add('text-green-600');
                    } else {
                        checkStatus.textContent = \`External check failed: Server responded with status \${response.status}\`;
                        checkStatus.classList.remove('text-gray-700');
                        checkStatus.classList.add('text-red-600');
                    }
                } catch (error) {
                    checkStatus.textContent = \`External check error: \${error.message}\`;
                    checkStatus.classList.remove('text-gray-700');
                    checkStatus.classList.add('text-red-600');
                    console.error('Error checking VLESS config with external service:', error);
                }
            });

            closeModalBtn.addEventListener('click', () => {
                vlessConfigModal.classList.add('hidden');
                vlessConfigModal.classList.remove('flex');
            });

            vlessConfigModal.addEventListener('click', (event) => {
                if (event.target === vlessConfigModal) {
                    vlessConfigModal.classList.add('hidden');
                    vlessConfigModal.classList.remove('flex');
                }
            });

            copyConfigBtn.addEventListener('click', () => {
                vlessUri.select();
                vlessUri.setSelectionRange(0, 99999);

                try {
                    document.execCommand('copy');
                    copyMessage.classList.remove('hidden');
                    setTimeout(() => {
                        copyMessage.classList.add('hidden');
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy text: ', err);
                }
            });
        });
    </script>
</body>
</html>`;
}

// ========== HTTP Server ==========
const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
        const qIdx = req.url.indexOf('?');
        const pathname = qIdx === -1 ? req.url : req.url.slice(0, qIdx);

        if (pathname === '/') {
            res.writeHead(200, HOME_HEADERS);
            res.end(HOME_HTML_BUFFER);
            return;
        }

        if (qIdx !== -1 && req.url.includes('check=VLESS__CONFIG')) {
            const hostname = (req.headers.host || 'localhost').split(':')[0];
            const vlessConfig = {
                uuid: uuid,
                port: port,
                host: hostname,
                vless_uri: `vless://${uuid}@${hostname}:443?security=tls&fp=randomized&type=ws&host=${hostname}&encryption=none#Nothflank-By-ModsBots`
            };
            const body = JSON.stringify(vlessConfig);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            });
            res.end(body);
            return;
        }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': 9 });
    res.end('Not Found');
});

// Increase server connection limits for better concurrency
server.maxConnections = 0;
server.keepAliveTimeout = 65000;
server.headersTimeout = 20000;

// ========== WebSocket Server (NO compression — saves CPU/RAM) ==========
const wss = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 128 * 1024 * 1024,
    skipUTF8Validation: true,
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, TCP_KEEPALIVE_DELAY);

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// ========== WebSocket Ping/Pong Heartbeat ==========
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            log('Terminating dead WebSocket connection');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, WS_PING_INTERVAL);

wss.on('close', () => {
    clearInterval(pingInterval);
});

// ========== VLESS Proxy Connection Handler ==========
wss.on('connection', (ws) => {
    log('New WebSocket connection');

    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.once('message', (msg) => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);

        // Validate UUID using pre-parsed bytes
        for (let j = 0; j < 16; j++) {
            if (id[j] !== UUID_BYTES[j]) {
                log('UUID mismatch. Connection rejected.');
                ws.close();
                return;
            }
        }

        // Parse VLESS header
        let i = msg.slice(17, 18).readUInt8() + 19;
        const targetPort = msg.slice(i, (i += 2)).readUInt16BE(0);
        const ATYP = msg.slice(i, (i += 1)).readUInt8();

        let host;
        if (ATYP === 1) {
            host = msg.slice(i, (i += 4)).join('.');
        } else if (ATYP === 2) {
            host = textDecoder.decode(
                msg.slice(i + 1, (i += 1 + msg.slice(i, i + 1).readUInt8()))
            );
        } else if (ATYP === 3) {
            host = msg
                .slice(i, (i += 16))
                .reduce(
                    (s, b, idx, arr) =>
                        idx % 2 ? s.concat(arr.slice(idx - 1, idx + 1)) : s,
                    []
                )
                .map((b) => b.readUInt16BE(0).toString(16))
                .join(':');
        } else {
            log('Unsupported ATYP:', ATYP);
            ws.close();
            return;
        }

        log('Connecting to:', host, targetPort);

        // Send VLESS handshake success response
        const vlessResponse = Buffer.allocUnsafe(2);
        vlessResponse[0] = VERSION;
        vlessResponse[1] = 0;
        ws.send(vlessResponse);

        // Create duplex stream with optimized buffer size
        const duplex = createWebSocketStream(ws, {
            highWaterMark: 64 * 1024,
            allowHalfOpen: false,
        });

        // Track cleanup state to prevent double-destroy
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (!duplex.destroyed) duplex.destroy();
            if (!tcpSocket.destroyed) tcpSocket.destroy();
        };

        // ========== TCP Connection ==========
        const tcpSocket = net.connect(
            { host, port: targetPort, allowHalfOpen: false },
            function () {
                log('TCP connected to:', host, targetPort);

                this.setNoDelay(true);
                this.setKeepAlive(true, TCP_KEEPALIVE_DELAY);

                // Write the remaining payload from the initial VLESS message
                this.write(msg.slice(i));

                // Pipe data bidirectionally
                duplex.pipe(this);
                this.pipe(duplex);
            }
        );

        // Connection timeout
        tcpSocket.setTimeout(TCP_CONNECT_TIMEOUT, () => {
            logError('TCP connection timeout to:', host, targetPort);
            cleanup();
        });

        tcpSocket.once('data', () => {
            tcpSocket.setTimeout(0);
        });

        // ========== Error & Cleanup Handlers ==========
        tcpSocket.on('error', (err) => {
            logError('TCP error to', host, targetPort, ':', err.message);
            cleanup();
        });

        duplex.on('error', (err) => {
            if (err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                logError('Duplex stream error:', err.message);
            }
            cleanup();
        });

        tcpSocket.on('close', cleanup);
        duplex.on('close', cleanup);
        ws.on('close', cleanup);
        ws.on('error', (err) => {
            logError('WebSocket error:', err.message);
            cleanup();
        });
    });

    ws.on('error', (err) => {
        logError('WebSocket initial error:', err.message);
    });
});

// ========== Start Server ==========
server.listen(port, () => {
    log('Server listening on port:', port);
    log('VLESS Proxy UUID:', uuid);
    log('Access home page at: http://localhost:' + port);
});

server.on('error', (err) => {
    logError('Server Error:', err.message);
});

// ========== Graceful Shutdown ==========
const gracefulShutdown = (signal) => {
    log(`Received ${signal}. Shutting down gracefully...`);

    server.close(() => {
        log('HTTP server closed');
    });

    wss.clients.forEach((ws) => {
        ws.terminate();
    });

    wss.close(() => {
        log('WebSocket server closed');
        process.exit(0);
    });

    const forceTimer = setTimeout(() => {
        logError('Forced shutdown after timeout');
        process.exit(1);
    }, 5000);
    forceTimer.unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ========== Prevent crash on unhandled errors ==========
process.on('uncaughtException', (err) => {
    logError('Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
    logError('Unhandled Rejection:', reason);
});
