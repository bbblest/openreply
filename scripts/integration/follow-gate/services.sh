#!/bin/sh
set -eu
[ "${WSL_DISTRO_NAME:-}" = "OpenReply-Test" ] || { echo 'Use the dedicated OpenReply-Test distro'; exit 1; }
data=/var/lib/openreply-integration
start_redis() {
  mkdir -p "$data/redis"
  redis-server --bind 127.0.0.1 --port 26379 --protected-mode yes \
    --appendonly yes --appendfsync always --dir "$data/redis" \
    --daemonize yes --pidfile "$data/redis.pid" --logfile "$data/redis.log"
  redis-cli -p 26379 ping
}
case "${1:-start}" in
  start)
    pg_conftool 17 main set port 25432
    pg_ctlcluster 17 main start
    runuser -u postgres -- psql -p 25432 -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE openreply_test LOGIN PASSWORD 'openreply-local-test';
CREATE DATABASE openreply_integration OWNER openreply_test;
SQL
    start_redis
    ;;
  restart-redis)
    # Test-only abrupt death. AOF is fsynced on every command, not a graceful SAVE.
    redis_pid=$(cat "$data/redis.pid")
    [ "$(readlink /proc/"$redis_pid"/exe)" = "$(readlink -f /usr/bin/redis-server)" ] || { echo 'Unexpected Redis executable'; exit 1; }
    kill -KILL "$redis_pid"
    start_redis
    ;;
  stop)
    redis-cli -p 26379 shutdown
    pg_ctlcluster 17 main stop
    ;;
  *) exit 1 ;;
esac
