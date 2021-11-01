namespace DotNetWebOnFargate.Alpha.Api 
{
    public class Breaker
    {
        public bool IsBroken { get; private set; } = false;

        public void Break() 
        {
            IsBroken = true;
        }
    }
}