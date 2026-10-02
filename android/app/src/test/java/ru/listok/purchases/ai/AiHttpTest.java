package ru.listok.purchases.ai;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public class AiHttpTest {
    @Test
    public void allowsOnlyTheProviderOverHttps() {
        assertTrue(AiHttp.isAllowed("https://routerai.ru/api/v1/key"));
        assertTrue(AiHttp.isAllowed("https://routerai.ru:443/api/v1/chat/completions"));
        assertFalse(AiHttp.isAllowed("http://routerai.ru/api/v1/key"));
        assertFalse(AiHttp.isAllowed("https://routerai.ru.example.com/api/v1/key"));
        assertFalse(AiHttp.isAllowed("https://user@routerai.ru/api/v1/key"));
        assertFalse(AiHttp.isAllowed("https://routerai.ru:8443/api/v1/key"));
        assertFalse(AiHttp.isAllowed("https://example.com/api/v1/key"));
        assertFalse(AiHttp.isAllowed("not a url"));
        assertFalse(AiHttp.isAllowed(null));
    }

    @Test
    public void refusesOtherHostsWithoutTouchingTheNetwork() throws Exception {
        JSONObject request = new JSONObject();
        request.put("method", "GET");
        request.put("url", "https://example.com/steal");
        assertEquals("blocked", new JSONObject(AiHttp.execute(request.toString())).getString("error"));

        request.put("url", "https://routerai.ru/api/v1/key");
        request.put("method", "DELETE");
        assertEquals("blocked", new JSONObject(AiHttp.execute(request.toString())).getString("error"));
    }

    @Test
    public void reportsBrokenPayloadsAsNetworkErrors() throws Exception {
        assertEquals("network", new JSONObject(AiHttp.execute("{")).getString("error"));
    }
}
