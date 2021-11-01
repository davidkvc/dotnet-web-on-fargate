using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace DotNetWebOnFargate.Beta.Api
{
    internal class IsBrokenCheck : IHealthCheck
    {
        private readonly Breaker _breaker;

        public IsBrokenCheck(Breaker breaker)
        {
            _breaker = breaker;
        }

        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
        {
            return _breaker.IsBroken
            ? HealthCheckResult.Unhealthy("the app is broken")
            : HealthCheckResult.Healthy();
        }
    }
}