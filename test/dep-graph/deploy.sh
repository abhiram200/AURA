#!/bin/bash
# Deploy script

source ./setup.sh
source ../config/env.sh

PROJECT_NAME="webapp"
export BUILD_ID=$(date +%s)

function build() {
    docker build -t "$PROJECT_NAME:$BUILD_ID" .
    docker push "$PROJECT_NAME:$BUILD_ID"
}

function deploy() {
    kubectl set image deployment/"$PROJECT_NAME" app="$PROJECT_NAME:$BUILD_ID"
    kubectl rollout status deployment/"$PROJECT_NAME"
}

function rollback() {
    kubectl rollout undo deployment/"$PROJECT_NAME"
}

# Run deployment
build
deploy