// Copyright 2026 Matthew Opie (mattopie.com) All Rights Reserved.

using blazor_portfolio_2026;
using blazor_portfolio_2026.Services;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(_ => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<OnboardingApiClient>();
builder.Services.AddScoped<OnboardingStateService>();

await builder.Build().RunAsync();
