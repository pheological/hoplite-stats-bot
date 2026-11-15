package dev.hoplite.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import me.earth.headlessmc.mc.gui.GuiButton;
import me.earth.headlessmc.mc.gui.GuiElement;
import me.earth.headlessmc.mc.gui.GuiScreen;
import me.earth.headlessmc.mc.gui.Slot;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.class_1703; // ScreenHandler (intermediary mappings, pinned to 1.21.11)
import net.minecraft.class_310;  // MinecraftClient
import net.minecraft.class_3936; // ScreenHandlerProvider

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Read-only snapshots after the vanilla client has applied inventory updates. */
public final class GuiBridge implements ClientModInitializer {
    public static final String PREFIX = "HOPLITE_GUI_EVENT ";
    private static final Gson JSON = new GsonBuilder().disableHtmlEscaping().create();
    // Bypass Minecraft's stdout logger so each JSON frame stays on one line.
    private static final PrintStream OUTPUT = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
    private static long sequence;
    private static long generation;
    private static long fullGeneration = -1;

    @Override
    public void onInitializeClient() {
        emit(Map.of("event", "ready", "minecraft", "1.21.11"));
    }

    public static void screenChanged() {
        generation++;
        fullGeneration = -1;
        snapshot("screen");
    }

    public static void inventoryChanged(int syncId, boolean full) {
        var client = class_310.method_1551();
        if (!(client.field_1755 instanceof class_3936<?> provider)) return;
        class_1703 handler = provider.method_17577();
        if (handler.field_7763 != syncId) return; // Ignore player inventory and stale menu packets.
        if (full) fullGeneration = generation;
        snapshot(full ? "contents" : "slot");
    }

    private static void snapshot(String reason) {
        try {
            var client = class_310.method_1551();
            var screen = client.field_1755;
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("event", "gui");
            data.put("reason", reason);
            data.put("generation", generation);
            data.put("screen", screen == null ? null : screen.getClass().getName());
            data.put("title", screen == null ? "" : screen.method_25440().getString());
            var uuid = client.method_1548().method_44717();
            data.put("playerUuid", uuid == null ? null : uuid.toString());
            data.put("connected", client.field_1724 != null);
            data.put("inventoryReady", false);
            data.put("syncId", null);
            List<Map<String, Object>> slots = new ArrayList<>();
            List<Map<String, Object>> buttons = new ArrayList<>();
            List<String> texts = new ArrayList<>();
            if (screen instanceof GuiScreen gui) {
                int menuSize = 0;
                if (screen instanceof class_3936<?> provider) {
                    class_1703 handler = provider.method_17577();
                    data.put("syncId", handler.field_7763);
                    int count = handler.field_7761.size() - 36;
                    if (count >= 9 && count <= 54 && count % 9 == 0) menuSize = count;
                    data.put("inventoryReady", fullGeneration == generation);
                }
                for (GuiElement element : gui.getAllElements()) {
                    if (element instanceof Slot) {
                        if (element.getId() >= menuSize || element.getText().isBlank()) continue;
                        slots.add(Map.of("id", element.getId(), "name", element.getText(), "tooltip", String.join("\n", element.getTooltip())));
                    } else {
                        if (!element.getText().isBlank()) texts.add(element.getText());
                        if (element instanceof GuiButton button) {
                            buttons.add(Map.of("id", element.getId(), "name", element.getText(), "enabled", button.isEnabled()));
                        }
                    }
                }
            }
            data.put("slots", slots);
            data.put("buttons", buttons);
            data.put("texts", texts);
            emit(data);
        } catch (RuntimeException exception) {
            emit(Map.of("event", "bridge-error", "message", exception.getClass().getSimpleName() + ": " + exception.getMessage()));
        }
    }

    private static synchronized void emit(Map<String, ?> values) {
        Map<String, Object> event = new LinkedHashMap<>(values);
        event.put("protocol", 1);
        event.put("seq", ++sequence);
        OUTPUT.println(PREFIX + JSON.toJson(event));
    }
}
