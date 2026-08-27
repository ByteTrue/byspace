package com.bytetrue.byspace.trace

import android.os.Trace
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BySpaceNativeTraceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BySpaceNativeTrace")

    Function("beginSection") { name: String ->
      Trace.beginSection(name.take(127))
    }

    Function("endSection") {
      Trace.endSection()
    }
  }
}
