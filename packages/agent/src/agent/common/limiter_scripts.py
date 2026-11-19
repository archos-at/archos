from __future__ import annotations

from agent.common import lease_slots

ACQUIRE_LUA = (
    """
local classes = 4
local now = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
local ticket_ttl = tonumber(ARGV[3])
local member = ARGV[4]
local rank = tonumber(ARGV[5])
local interval = tonumber(ARGV[6])
local state_ttl = tonumber(ARGV[7])
local scoped = tonumber(ARGV[10])
local model = ARGV[13]

local function limit_of(state, floor_limit, ceiling)
  local stored = redis.call('HMGET', state, 'limit', 'changed')
  local limit = tonumber(stored[1]) or ceiling
  local changed = tonumber(stored[2]) or now
  if limit > ceiling then limit = ceiling end
  if limit < floor_limit then limit = floor_limit end
  if changed > now then changed = now end
  if limit < ceiling and now - changed >= interval then
    limit = limit + 1
    redis.call('HSET', state, 'limit', limit, 'changed', now)
    redis.call('EXPIRE', state, state_ttl)
  end
  return limit
end

local limit = limit_of(KEYS[6 + classes], tonumber(ARGV[8]), tonumber(ARGV[9]))
local scoped_limit = 0
if scoped == 1 then
  scoped_limit = limit_of(KEYS[7 + classes], tonumber(ARGV[11]), tonumber(ARGV[12]))
end
"""
    + lease_slots.RANKED_ADMISSION_LUA
)

THROTTLE_LUA = """
local state = KEYS[1]
local now = tonumber(ARGV[1])
local floor_limit = tonumber(ARGV[2])
local ceiling = tonumber(ARGV[3])
local cooldown = tonumber(ARGV[4])
local state_ttl = tonumber(ARGV[5])

local stored = redis.call('HMGET', state, 'limit', 'cut')
local limit = tonumber(stored[1]) or ceiling
local cut = tonumber(stored[2]) or 0
if limit > ceiling then limit = ceiling end
if cut <= now and now - cut < cooldown then
  return limit
end
limit = math.max(floor_limit, math.floor(limit / 2))
redis.call('HSET', state, 'limit', limit, 'changed', now, 'cut', now)
redis.call('EXPIRE', state, state_ttl)
return limit
"""
