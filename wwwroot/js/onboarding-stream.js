window.onboardingStream = {
    streamQuery: async function (baseUrl, tenantId, query, dotnetRef) {
        const response = await fetch(`${baseUrl}/tenants/${tenantId}/query/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });

        if (!response.ok || !response.body) {
            const text = await response.text();
            await dotnetRef.invokeMethodAsync("HandleError", text || `Stream request failed (${response.status})`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                await dispatchEvent(rawEvent, dotnetRef);
                boundary = buffer.indexOf("\n\n");
            }
        }

        if (buffer.trim().length > 0) {
            await dispatchEvent(buffer, dotnetRef);
        }
    }
};

async function dispatchEvent(rawEvent, dotnetRef) {
    const lines = rawEvent.split("\n");
    let eventName = "message";
    const dataLines = [];

    for (const line of lines) {
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
        }
    }

    const data = dataLines.join("\n");
    if (!data) {
        return;
    }

    switch (eventName) {
        case "toolLog":
            await dotnetRef.invokeMethodAsync("HandleToolLog", data);
            break;
        case "token":
            await dotnetRef.invokeMethodAsync("HandleToken", JSON.parse(data).text ?? "");
            break;
        case "contexts":
            await dotnetRef.invokeMethodAsync("HandleContexts", data);
            break;
        case "telemetry":
            await dotnetRef.invokeMethodAsync("HandleTelemetry", data);
            break;
        case "done":
            await dotnetRef.invokeMethodAsync("HandleDone");
            break;
        case "error":
            await dotnetRef.invokeMethodAsync("HandleError", JSON.parse(data).message ?? data);
            break;
    }
}
