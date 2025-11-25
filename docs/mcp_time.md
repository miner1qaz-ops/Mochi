# MCP Time Server Setup

The time MCP server provides current time and timezone conversion tools. Use it to keep logs in ISO-8601 and avoid stale timestamps.

## Install (pip fallback)
We cloned the reference at `tmp_mcp_servers/src/time`. For a proper install:
1) Install venv + pip (if needed): `sudo apt-get install -y python3.13-venv python3-pip`
2) Create a virtualenv: `python3 -m venv ~/.venvs/mcp-time && source ~/.venvs/mcp-time/bin/activate`
3) Install: `pip install mcp-server-time`
4) Start the server:
```bash
~/.venvs/mcp-time/bin/python -m mcp_server_time
```

If you prefer `uv`:
```bash
uvx mcp-server-time
```

## Configure clients
- VS Code / Claude / Zed: add MCP server entry named `time`:
```json
{
  "mcp": {
    "servers": {
      "time": { "command": "python", "args": ["-m", "mcp_server_time"] }
    }
  }
}
```

## Using the tools
- `get_current_time(timezone)` → returns ISO timestamp for the IANA timezone.
- `convert_time(source_timezone, time, target_timezone)` → converts HH:MM between zones.

## Current timestamp
- UTC anchor: `2025-11-25T00:14:10+00:00`
- Singapore (GMT+8) anchor: `2025-11-25T08:17+08:00`
Use these as the latest anchors for log entries until the MCP time server is running.
