#!/bin/bash
set -e

# Source helper scripts
source ./helpers.sh
. /etc/environment

# Variables
APP_NAME="myapp"
APP_VERSION="1.0.0"
export DEPLOY_ENV="production"

# Setup function
function setup() {
    local dir=$1
    mkdir -p "$dir"
    cd "$dir"
    echo "Setup complete in $dir"
}

# Validate function
validate() {
    if [ -z "$APP_NAME" ]; then
        echo "APP_NAME is required"
        return 1
    fi
    docker inspect "$APP_NAME" > /dev/null 2>&1
}

# Main
setup "/opt/app"
validate