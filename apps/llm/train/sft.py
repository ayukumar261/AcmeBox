#!/usr/bin/env python
"""LoRA SFT for LFM2.5-8B-A1B (MoE). RUN ON A GPU POD (separate from serving).

Trains a LoRA adapter on the gold transcripts exported by
``acmebox-flywheel export``. Heavy imports (torch/peft/datasets) are inside
``main`` so ``data.py`` stays CPU-importable for tests.

LoRA targeting note — LFM2.5-8B-A1B is a `Lfm2MoeForCausalLM` (hybrid conv +
GQA-attention with sparse MoE FFNs). Its experts are fused `nn.Parameter` tensors
(`gate_up_proj` / `down_proj`), NOT `nn.Linear`, so PEFT LoRA cannot adapt them;
the router `gate` should be left alone too. We therefore adapt the attention
projections (`q_proj,k_proj,v_proj,out_proj` — note `out_proj`, not `o_proj`),
which is the right lever for teaching policy-adherence and tool-call formatting.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="LoRA SFT for LFM2.5-8B-A1B.")
    p.add_argument("--dataset", default=_env("DATASET", ""), required=not os.environ.get("DATASET"),
                   help="Path to the exported sft.jsonl.")
    p.add_argument("--base-model", default=_env("BASE_MODEL", "LiquidAI/LFM2.5-8B-A1B"))
    p.add_argument("--output-dir", default=_env("OUTPUT_DIR", "adapters/adapter-latest"))
    p.add_argument("--max-seq-len", type=int, default=int(_env("TRAIN_MAX_SEQ_LEN", "16384")),
                   help="Examples longer than this are dropped (default 16384 = serving ctx; "
                        "exported examples run ~8k tokens, so keep this high).")
    p.add_argument("--epochs", type=float, default=float(_env("TRAIN_EPOCHS", "3")))
    p.add_argument("--lr", type=float, default=float(_env("TRAIN_LR", "2e-4")))
    p.add_argument("--batch-size", type=int, default=int(_env("TRAIN_BATCH_SIZE", "1")))
    p.add_argument("--grad-accum", type=int, default=int(_env("TRAIN_GRAD_ACCUM", "8")))
    p.add_argument("--lora-r", type=int, default=int(_env("LORA_R", "16")))
    p.add_argument("--lora-alpha", type=int, default=int(_env("LORA_ALPHA", "32")))
    p.add_argument("--lora-dropout", type=float, default=float(_env("LORA_DROPOUT", "0.05")))
    p.add_argument("--target-modules", default=_env("LORA_TARGET_MODULES", "q_proj,k_proj,v_proj,out_proj"))
    p.add_argument("--load-in-4bit", action="store_true", default=_env("LOAD_IN_4BIT", "") not in ("", "0", "false"),
                   help="QLoRA: load the base in 4-bit (saves VRAM on a smaller card).")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.dataset:
        raise SystemExit("Set --dataset (or DATASET) to the exported sft.jsonl path.")

    # Curb allocator fragmentation on long (~10k-token) sequences. Must be set
    # before CUDA initialises (i.e. before the first torch CUDA alloc below).
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        DataCollatorForSeq2Seq,
        Trainer,
        TrainingArguments,
    )

    # data.py sits next to this file; import it whether run as a script or module.
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from data import LOSS_IGNORE_INDEX, build_features, count_supervised_tokens, load_jsonl

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)

    # --- build the tokenized, loss-masked dataset ---
    kept, dropped, supervised = [], 0, 0
    for record in load_jsonl(args.dataset):
        feats = build_features(record, tokenizer)
        if len(feats["input_ids"]) > args.max_seq_len:
            dropped += 1
            continue
        supervised += count_supervised_tokens(feats)
        kept.append(feats)
    if not kept:
        raise SystemExit(f"No usable examples in {args.dataset} (all dropped > {args.max_seq_len} tokens).")
    print(f"[data] {len(kept)} examples kept, {dropped} dropped (> {args.max_seq_len} tokens); "
          f"{supervised} supervised assistant tokens total")
    dataset = Dataset.from_list(kept)

    # --- load base + attach LoRA ---
    quant_config = None
    if args.load_in_4bit:
        from transformers import BitsAndBytesConfig
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
        )

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        dtype=torch.bfloat16,
        quantization_config=quant_config,
        # Memory-efficient attention: the exported examples run ~10k tokens, and
        # "eager" materialises the full [seq,seq] QK^T matrix → CUDA OOM on the
        # A40. SDPA (built into torch, no extra deps) avoids that. Override with
        # ATTN_IMPL=eager if a correctness issue surfaces with the hybrid attn.
        attn_implementation=_env("ATTN_IMPL", "sdpa"),
    )
    model.config.use_cache = False
    if quant_config is not None:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)

    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[m.strip() for m in args.target_modules.split(",") if m.strip()],
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.enable_input_require_grads()  # needed for grad checkpointing through a frozen base
    model.print_trainable_parameters()

    # --- train ---
    collator = DataCollatorForSeq2Seq(
        tokenizer, label_pad_token_id=LOSS_IGNORE_INDEX, padding="longest"
    )
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=5,
        save_strategy="epoch",
        report_to=[],
    )
    trainer = Trainer(
        model=model, args=training_args, train_dataset=dataset, data_collator=collator
    )
    trainer.train()

    # Save the adapter (+ tokenizer) so vLLM can serve it via --lora-modules.
    out = Path(args.output_dir)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"[done] adapter saved to {out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
