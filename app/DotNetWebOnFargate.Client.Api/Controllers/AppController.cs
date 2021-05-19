using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DotNetWebOnFargate.Client.Api.Controllers
{
    [ApiController]
    public class AppController : ControllerBase
    {
        [HttpGet("/")]
        public IActionResult Get()
        {
            return Ok(new {hello="world"});
        }

        [HttpGet("/whatever")]
        public async Task GetWhatever()
        {
            using var client = new HttpClient();
            using var response = await client.GetAsync("http://main.dotnetwebonfargate/whatever");

            HttpContext.Response.StatusCode = 200;
            HttpContext.Response.ContentType = "application/json";
            await response.Content.CopyToAsync(HttpContext.Response.Body);
        }

        [HttpGet("/break")]
        public IActionResult Break([FromServices] Breaker breaker)
        {
            breaker.Break();
            return Ok(new {message="broken"});
        }

        [HttpGet("/status")]
        public IActionResult GetStatus([FromServices] Breaker breaker)
        {
            return Ok(new {isBroken = breaker.IsBroken});
        }
    }
}
