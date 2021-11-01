using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DotNetWebOnFargate.Alpha.Api.Controllers
{
    [ApiController]
    public class AppController : ControllerBase
    {
        private readonly IHttpClientFactory _clientFactory;

        public AppController(IHttpClientFactory clientFactory)
        {
            _clientFactory = clientFactory;
        }

        [HttpGet("/")]
        public async Task<IActionResult> Get()
        {
            var betaClient = _clientFactory.CreateClient("beta");
            var betaResponse = await betaClient.GetFromJsonAsync<dynamic>("");

            return Ok(new
            {
                Beta = betaResponse
            });
        }

        [HttpGet("/hello")]
        public IActionResult GetHello()
        {
            return Ok("hello5");
        }
    }
}
