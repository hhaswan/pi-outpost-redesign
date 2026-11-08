#!/bin/bash
socat TCP-LISTEN:5174,fork,bind=10.11.3.77 TCP:127.0.0.1:5173 &
