package dev.hoplite.bridge.mixin;

import dev.hoplite.bridge.GuiBridge;
import net.minecraft.class_2649;
import net.minecraft.class_2653;
import net.minecraft.class_634;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = class_634.class, remap = false)
public abstract class InventoryMixin {
    // InventoryS2CPacket: all items have been applied when this callback executes.
    @Inject(method = "method_11153", at = @At("TAIL"), remap = false)
    private void hoplite$inventory(class_2649 packet, CallbackInfo info) {
        GuiBridge.inventoryChanged(packet.comp_3837(), true);
    }

    // ScreenHandlerSlotUpdateS2CPacket: emit subsequent changes too.
    @Inject(method = "method_11109", at = @At("TAIL"), remap = false)
    private void hoplite$slot(class_2653 packet, CallbackInfo info) {
        GuiBridge.inventoryChanged(packet.method_11452(), false);
    }
}
