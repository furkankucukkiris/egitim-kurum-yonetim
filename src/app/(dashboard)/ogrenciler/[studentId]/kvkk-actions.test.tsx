import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KvkkActions } from "./kvkk-actions";

vi.mock("./actions", () => ({
  anonymizeStudent: vi.fn(),
}));

const baseProps = {
  studentId: "11111111-1111-1111-1111-111111111111",
  fullName: "Ayşe Yılmaz",
  isArchived: true,
  isAlreadyAnonymized: false,
};

describe("KvkkActions", () => {
  it("öğrenci arşivlenmemişse Anonimleştir butonu devre dışıdır", () => {
    render(<KvkkActions {...baseProps} isArchived={false} />);

    expect(screen.getByRole("button", { name: "Anonimleştir" })).toBeDisabled();
  });

  it("zaten anonimleştirilmişse Anonimleştir butonu hiç gösterilmez", () => {
    render(<KvkkActions {...baseProps} isAlreadyAnonymized />);

    expect(screen.queryByRole("button", { name: "Anonimleştir" })).not.toBeInTheDocument();
  });

  it("onay formu açıldığında, ad yanlış yazılmışken kalıcı olarak anonimleştir butonu devre dışı kalır", async () => {
    const user = userEvent.setup();
    render(<KvkkActions {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Anonimleştir" }));

    const confirmButton = screen.getByRole("button", {
      name: "Kalıcı olarak anonimleştir",
    });

    expect(confirmButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(/Onaylamak için öğrencinin tam adını yazın/),
      "Yanlış Ad",
    );

    expect(confirmButton).toBeDisabled();
  });

  it("ad tam olarak eşleşince ve neden girilince onay butonu etkinleşir", async () => {
    const user = userEvent.setup();
    render(<KvkkActions {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Anonimleştir" }));

    await user.type(
      screen.getByLabelText(/Onaylamak için öğrencinin tam adını yazın/),
      baseProps.fullName,
    );

    await user.type(screen.getByLabelText("Anonimleştirme nedeni"), "KVKK madde 11 talebi");

    expect(screen.getByRole("button", { name: "Kalıcı olarak anonimleştir" })).toBeEnabled();
  });

  it("vazgeç butonu onay formunu kapatır", async () => {
    const user = userEvent.setup();
    render(<KvkkActions {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Anonimleştir" }));
    expect(screen.getByRole("button", { name: "Kalıcı olarak anonimleştir" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vazgeç" }));

    expect(
      screen.queryByRole("button", { name: "Kalıcı olarak anonimleştir" }),
    ).not.toBeInTheDocument();
  });
});
