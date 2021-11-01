#!/bin/bash

set -eux
set -o pipefail

aws ssm get-parameter --name /david/dotnetwebonfargate/secrets --with-decryption --query 'Parameter.Value' | jq '.|fromjson' > secrets.json

# log to uniquely named file to avoid conflicts when multiple processes share volume with logs dir
export Logging__File__Path=/logs/$(uuidgen).log

exec dotnet DotNetWebOnFargate.Alpha.Api.dll
