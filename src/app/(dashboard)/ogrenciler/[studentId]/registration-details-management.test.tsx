import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegistrationDetailsManagement } from "./registration-details-management";

vi.mock("./actions", () => ({
  updateRegistrationDetails: vi.fn(async () => ({ error: null })),
}));

const baseProps = {
  studentId: "11111111-1111-1111-1111-111111111111",
  details: {
    homeAddress: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    healthNotes: "",
    photoVideoConsent: "izinsiz" as const,
    kvkkConsentAccepted: false,
    institutionRulesAccepted: false,
  },
};

describe("RegistrationDetailsManagement", () => {
  it("mevcut fotoğraf/video tercihini varsayılan olarak seçili gösterir", () => {
    render(<RegistrationDetailsManagement {...baseProps} />);

    expect(screen.getByLabelText("Fotoğraf / video kullanım tercihi")).toHaveValue("izinsiz");
  });

  it("kurum kuralları ve KVKK onay kutuları başlangıçta işaretsizdir", () => {
    render(<RegistrationDetailsManagement {...baseProps} />);

    expect(
      screen.getByRole("checkbox", { name: /Kurum kurallarını kabul etti/ }),
    ).not.toBeChecked();

    expect(
      screen.getByRole("checkbox", {
        name: /KVKK aydınlatma metnini kabul etti/,
      }),
    ).not.toBeChecked();
  });

  it("onay kutusuna tıklandığında işaretli hâle gelir", async () => {
    const user = userEvent.setup();
    render(<RegistrationDetailsManagement {...baseProps} />);

    const checkbox = screen.getByRole("checkbox", {
      name: /KVKK aydınlatma metnini kabul etti/,
    });

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("sağlık/alerji notu gibi hassas alanların 'yalnızca yöneticiler' uyarısını gösterir", () => {
    render(<RegistrationDetailsManagement {...baseProps} />);

    expect(screen.getByText(/yalnızca yöneticiler tarafından görülür/)).toBeInTheDocument();
  });

  it("mevcut değerleri (adres, sağlık notu) formda önceden doldurur", () => {
    render(
      <RegistrationDetailsManagement
        {...baseProps}
        details={{
          ...baseProps.details,
          homeAddress: "Test Mahallesi No:1",
          healthNotes: "Fıstık alerjisi",
        }}
      />,
    );

    expect(screen.getByLabelText("Adres")).toHaveValue("Test Mahallesi No:1");
    expect(screen.getByLabelText("Sağlık / alerji bilgisi")).toHaveValue("Fıstık alerjisi");
  });
});
