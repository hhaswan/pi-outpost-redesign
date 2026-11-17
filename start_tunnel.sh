#!/bin/bash
# Expose the Vite dev server (127.0.0.1:5173) on a LAN address: BIND_ADDR=<HOST_IP> ./start_tunnel.sh
socat TCP-LISTEN:5174,fork,bind="${BIND_ADDR:?set BIND_ADDR to the LAN address of this machine}" TCP:127.0.0.1:5173 &
