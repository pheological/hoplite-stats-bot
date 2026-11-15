package dev.hoplite.bridge.mixin;

import dev.hoplite.bridge.GuiBridge;
import net.minecraft.class_310;
import net.minecraft.class_437;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = class_310.class, remap = false)
public abstract class ScreenMixin {
    @Inject(method = "method_1507", at = @At("TAIL"), remap = false)
    private void hoplite$screenChanged(class_437 screen, CallbackInfo info) {
        GuiBridge.screenChanged();
    }
}
